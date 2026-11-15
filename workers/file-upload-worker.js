const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const KEY_ITERATIONS = 120_000;
const KEY_ROLES = new Set(["site_access", "upload"]);
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && (!allowedOrigins.length || !allowedOrigins.includes(origin))) return null;

  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function safeFileName(name) {
  const normalized = name.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return [...normalized].slice(0, 180).join("") || "upload";
}

async function deriveKeyHash(key, salt, iterations = KEY_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: Uint8Array.from(atob(salt), (character) => character.charCodeAt(0)),
    iterations
  }, material, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

async function verifyKey(env, role, key) {
  if (!env.DB || !KEY_ROLES.has(role) || typeof key !== "string" || key.length < 1 || key.length > 512) {
    return false;
  }
  const stored = await env.DB.prepare(
    "SELECT salt, key_hash, iterations FROM access_keys WHERE role = ?"
  ).bind(role).first();
  if (!stored || !Number.isInteger(stored.iterations) || stored.iterations < 100_000 || stored.iterations > 500_000) {
    return false;
  }
  return constantTimeEqual(await deriveKeyHash(key, stored.salt, stored.iterations), stored.key_hash);
}

async function clientHash(request) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function attemptState(env, role, addressHash) {
  return env.DB.prepare(
    "SELECT failures, locked_until FROM auth_attempts WHERE role = ? AND client_hash = ?"
  ).bind(role, addressHash).first();
}

async function recordFailure(env, role, addressHash) {
  const current = await attemptState(env, role, addressHash);
  const failures = (current?.failures || 0) + 1;
  const lockCount = Math.floor((current?.failures || 0) / MAX_ATTEMPTS);
  const lockedUntil = failures % MAX_ATTEMPTS === 0
    ? Date.now() + Math.min(BASE_LOCK_MS * (2 ** lockCount), 60 * 60 * 1000)
    : current?.locked_until || 0;
  await env.DB.prepare(`
    INSERT INTO auth_attempts (role, client_hash, failures, locked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(role, client_hash) DO UPDATE SET
      failures = excluded.failures,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at
  `).bind(role, addressHash, failures, lockedUntil, Date.now()).run();
}

async function clearFailures(env, role, addressHash) {
  await env.DB.prepare(
    "DELETE FROM auth_attempts WHERE role = ? AND client_hash = ?"
  ).bind(role, addressHash).run();
}

async function verifyRequestKey(request, env, role, key) {
  const addressHash = await clientHash(request);
  const state = await attemptState(env, role, addressHash);
  if (state?.locked_until > Date.now()) {
    return { ok: false, response: jsonResponse({ error: "尝试次数过多，请稍后重试。" }, 429, corsHeaders(request, env)) };
  }
  if (!await verifyKey(env, role, key)) {
    await recordFailure(env, role, addressHash);
    return { ok: false, response: jsonResponse({ error: "密钥无效。" }, 401, corsHeaders(request, env)) };
  }
  await clearFailures(env, role, addressHash);
  return { ok: true };
}

async function readLimitedBody(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_SIZE) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function githubRequest(env, path, init = {}) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_BRANCH) {
    throw new Error("GitHub 上传服务尚未配置。");
  }
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CloudG-file-upload-worker",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("GitHub API request failed", response.status, detail.slice(0, 500));
    throw new Error(`GitHub 文件存储请求失败 (${response.status})`);
  }
  return response.json();
}

async function uploadFile(request, env, cors) {
  const authorization = request.headers.get("Authorization") || "";
  const uploadKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const verified = await verifyRequestKey(request, env, "upload", uploadKey);
  if (!verified.ok) return verified.response;

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
    return jsonResponse({ error: "单个文件最大为 10 MiB。" }, 413, cors);
  }
  const encodedName = request.headers.get("X-File-Name") || "";
  let originalName;
  try {
    if (!encodedName || encodedName.length > 4096) throw new Error("Missing file name");
    originalName = decodeURIComponent(encodedName);
  } catch {
    return jsonResponse({ error: "文件名无效。" }, 400, cors);
  }
  if (!request.body) return jsonResponse({ error: "上传请求没有文件内容。" }, 400, cors);

  const bytes = await readLimitedBody(request.body);
  if (!bytes) return jsonResponse({ error: "单个文件最大为 10 MiB。" }, 413, cors);

  const name = safeFileName(originalName);
  const directory = (env.GITHUB_UPLOAD_DIRECTORY || "uploads").replace(/^\/+|\/+$/g, "");
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(directory) || directory.split("/").includes("..")) {
    return jsonResponse({ error: "GitHub 上传目录配置无效。" }, 500, cors);
  }
  const storedPath = `${directory}/${crypto.randomUUID()}-${name}`;
  const encodedPath = storedPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const commit = await githubRequest(env, `contents/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Upload ${name}`,
      content: toBase64(bytes),
      branch: env.GITHUB_BRANCH
    })
  });
  return jsonResponse({
    file: { name, path: storedPath, size: bytes.byteLength },
    commit: commit.commit?.sha || ""
  }, 201, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return jsonResponse({ error: "不支持的请求方法。" }, 405, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/auth") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "请求格式无效。" }, 400, cors);
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return jsonResponse({ error: "请求格式无效。" }, 400, cors);
        }
        const verified = await verifyRequestKey(request, env, "site_access", body.key);
        return verified.ok
          ? jsonResponse({ authenticated: true }, 200, cors)
          : verified.response;
      }
      if (url.pathname === "/api/upload") return await uploadFile(request, env, cors);
      return jsonResponse({ error: "未找到请求的接口。" }, 404, cors);
    } catch (error) {
      console.error("File API request failed", error);
      return jsonResponse({ error: "文件服务暂时不可用，请稍后重试。" }, 500, cors);
    }
  }
};
