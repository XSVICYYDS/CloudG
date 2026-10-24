const AUTH_STATE_KEY = "cloudg-download-auth-v1";
const RATE_LIMIT_KEY = "cloudg-download-rate-v1";
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000;
const CAPTCHA_TTL_MS = 30_000;
const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authForm = document.querySelector("#auth-form");
const authInput = document.querySelector("#access-key");
const authError = document.querySelector("#auth-error");
const fileList = document.querySelector("#file-list");
const searchInput = document.querySelector("#search-input");
const typeFilter = document.querySelector("#type-filter");
const sortOrder = document.querySelector("#sort-order");
const emptyState = document.querySelector("#empty-state");
const downloadStatus = document.querySelector("#download-status");
const previewDialog = document.querySelector("#preview-dialog");
const previewContent = document.querySelector("#preview-content");
const previewTitle = document.querySelector("#preview-title");
const previewPath = document.querySelector("#preview-path");
const previewMeta = document.querySelector("#preview-meta");
const previewDownload = document.querySelector("#preview-download");
let config;
let files = [];
let visibleLimit = 50;
let mathAnswer = 0;
let captchaValue = "";
let captchaExpiresAt = 0;
let captchaIssuedAt = 0;
let previewObjectUrl = "";
let previewRequest = null;

const PREVIEW_LIMITS = {
  text: 1 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  media: 50 * 1024 * 1024
};

function readJSON(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function isUnlocked() {
  const auth = readJSON(sessionStorage, AUTH_STATE_KEY, null);
  return auth && Number.isFinite(auth.expiresAt) && auth.expiresAt > Date.now();
}

function openSite() {
  authView.hidden = true;
  appView.hidden = false;
  const auth = readJSON(sessionStorage, AUTH_STATE_KEY, null);
  if (auth) window.setTimeout(() => {
    if (isUnlocked()) return;
    sessionStorage.removeItem(AUTH_STATE_KEY);
    files = [];
    fileList.replaceChildren();
    showLockScreen();
  }, Math.max(0, auth.expiresAt - Date.now()));
  loadFiles();
}

function showLockScreen() {
  appView.hidden = true;
  authView.hidden = false;
  authInput.focus();
}

function rateLimitState() {
  const state = readJSON(localStorage, RATE_LIMIT_KEY, { attempts: 0, lockouts: 0, lockedUntil: 0 });
  return {
    attempts: Number.isFinite(state.attempts) ? state.attempts : 0,
    lockouts: Number.isFinite(state.lockouts) ? state.lockouts : 0,
    lockedUntil: Number.isFinite(state.lockedUntil) ? state.lockedUntil : 0
  };
}

function remainingLockMs() {
  return Math.max(0, rateLimitState().lockedUntil - Date.now());
}

function formatWait(ms) {
  return `${Math.max(1, Math.ceil(ms / 1000))} 秒后重试`;
}

function recordFailure() {
  const state = rateLimitState();
  state.attempts += 1;
  if (state.attempts >= MAX_ATTEMPTS) {
    state.lockouts += 1;
    state.lockedUntil = Date.now() + Math.min(BASE_LOCK_MS * (2 ** (state.lockouts - 1)), 60 * 60 * 1000);
    state.attempts = 0;
  }
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(state));
  return state;
}

function setAuthMessage(message) {
  authError.textContent = message;
}

function setAuthFormEnabled(enabled) {
  authForm.querySelectorAll("input, button").forEach((control) => {
    control.disabled = !enabled;
  });
}

function randomInt(max) {
  if (!Number.isInteger(max) || max < 1 || max > 0x1_0000_0000) {
    throw new RangeError("随机数上限无效");
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const value = new Uint32Array(1);
  do {
    window.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % max;
}

function updateClock() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  document.querySelector("#clock-date").textContent =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  document.querySelector("#clock-time").textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const period = now.getHours() < 12 ? "上午" : "下午";
  document.querySelector("#clock-day-period").textContent = `星期${"日一二三四五六"[now.getDay()]}　${period}`;
}

function fillCurrentTime() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  document.querySelector("#current-date").value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  document.querySelector("#current-time").value =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function createMathChallenge() {
  const cloud = document.querySelector("#number-cloud");
  const svg = document.querySelector(".interference-lines");
  cloud.replaceChildren();
  svg.replaceChildren();
  const colors = ["#dc4f71", "#7c55cf", "#2088a8", "#dd8a21", "#258d63", "#df6040", "#4169c5", "#b1499b"];
  const digits = Array.from({ length: 8 }, () => 10 + randomInt(90));
  const positions = [
    [5, 5], [37, 3], [72, 8], [15, 38],
    [52, 32], [83, 42], [30, 64], [66, 68]
  ];
  const order = positions.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (let i = 0; i < digits.length; i += 1) {
    const digit = document.createElement("span");
    digit.className = "challenge-digit";
    digit.textContent = String(digits[i]);
    digit.style.left = `${positions[order[i]][0]}%`;
    digit.style.top = `${positions[order[i]][1]}%`;
    digit.style.color = colors[randomInt(colors.length)];
    digit.style.transform = `rotate(${randomInt(31) - 15}deg)`;
    cloud.append(digit);

    if (i < 6) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(randomInt(1000)));
      line.setAttribute("y1", String(randomInt(1000)));
      line.setAttribute("x2", String(randomInt(1000)));
      line.setAttribute("y2", String(randomInt(1000)));
      line.setAttribute("stroke", colors[randomInt(colors.length)]);
      line.setAttribute("stroke-width", String(1 + randomInt(3)));
      line.setAttribute("stroke-opacity", "0.34");
      svg.append(line);
    }
  }

  const first = digits[randomInt(digits.length)];
  const second = digits[randomInt(digits.length)];
  const subtract = randomInt(2) === 1;
  const larger = Math.max(first, second);
  const smaller = Math.min(first, second);
  mathAnswer = subtract ? larger - smaller : first + second;
  document.querySelector("#math-prompt").textContent = subtract
    ? `计算图中数字：${larger} − ${smaller} = ?`
    : `计算图中数字：${first} + ${second} = ?`;
  document.querySelector("#math-answer").value = "";
}

function updateCaptchaCountdown() {
  const countdown = document.querySelector("#captcha-countdown");
  const remaining = captchaExpiresAt - Date.now();
  if (!captchaValue || remaining <= 0) {
    captchaValue = "";
    countdown.textContent = "未获取";
    return;
  }
  countdown.textContent = `· ${Math.ceil(remaining / 1000)} 秒有效`;
}

function issueCaptcha() {
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  captchaValue = Array.from(bytes, (byte) => CAPTCHA_ALPHABET[byte % CAPTCHA_ALPHABET.length]).join("");
  captchaIssuedAt = Date.now();
  captchaExpiresAt = captchaIssuedAt + CAPTCHA_TTL_MS;
  updateCaptchaCountdown();
  window.alert(`本次验证码：${captchaValue}\n请在 30 秒内复制并输入。验证码仅在本页有效。`);
}

function isCurrentTime(dateValue, timeValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}:\d{2}$/.test(timeValue)) return false;
  const entered = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(entered.getTime())) return false;
  return Math.abs(Date.now() - entered.getTime()) <= 90_000;
}

document.querySelector("#fill-time").addEventListener("click", fillCurrentTime);
document.querySelector("#get-captcha").addEventListener("click", issueCaptcha);
document.querySelector("#config-retry").addEventListener("click", start);
window.setInterval(updateClock, 1000);
window.setInterval(updateCaptchaCountdown, 250);
updateClock();
createMathChallenge();

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const wait = remainingLockMs();
  if (wait > 0) {
    setAuthMessage(`尝试次数过多，请${formatWait(wait)}。`);
    return;
  }
  if (document.querySelector("#website").value.trim()) return;
  if (authInput.value !== config.accessKey) {
    const state = recordFailure();
    const newWait = remainingLockMs();
    setAuthMessage(newWait > 0
      ? `尝试次数过多，已暂时锁定。请${formatWait(newWait)}。`
      : `密钥不正确。还可尝试 ${MAX_ATTEMPTS - state.attempts} 次。`);
    authInput.focus();
    return;
  }
  if (!isCurrentTime(document.querySelector("#current-date").value, document.querySelector("#current-time").value)) {
    recordFailure();
    setAuthMessage("日期或时间格式不正确，或与左侧当前时间相差超过 90 秒。");
    return;
  }
  if (!/^\d+$/.test(document.querySelector("#math-answer").value)
      || Number(document.querySelector("#math-answer").value) !== mathAnswer) {
    recordFailure();
    setAuthMessage("数字计算不正确，请根据左侧数字重新计算。");
    createMathChallenge();
    return;
  }
  if (!captchaValue || Date.now() >= captchaExpiresAt
      || Date.now() - captchaIssuedAt < 1200
      || document.querySelector("#captcha-input").value.trim().toUpperCase() !== captchaValue) {
    recordFailure();
    setAuthMessage("验证码错误或已过期，请重新获取后输入。");
    captchaValue = "";
    updateCaptchaCountdown();
    return;
  }

  localStorage.removeItem(RATE_LIMIT_KEY);
  captchaValue = "";
  sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify({
    expiresAt: Date.now() + config.sessionTtlHours * 60 * 60 * 1000
  }));
  setAuthMessage("");
  openSite();
});

document.querySelector("#toggle-key").addEventListener("click", (event) => {
  const visible = authInput.type === "text";
  authInput.type = visible ? "password" : "text";
  event.currentTarget.textContent = visible ? "显示" : "隐藏";
  event.currentTarget.setAttribute("aria-label", visible ? "显示密钥" : "隐藏密钥");
});

document.querySelector("#lock-button").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_STATE_KEY);
  files = [];
  fileList.replaceChildren();
  showLockScreen();
});

document.querySelector("#refresh-button").addEventListener("click", loadFiles);
document.querySelector("#preview-close").addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("close", clearPreview);
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
searchInput.addEventListener("input", resetFilePage);
typeFilter.addEventListener("change", resetFilePage);
sortOrder.addEventListener("change", resetFilePage);
document.querySelector("#load-more").addEventListener("click", () => {
  visibleLimit += 50;
  renderFiles();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !appView.hidden && document.activeElement !== searchInput
      && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    renderFiles();
    searchInput.blur();
  }
});

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知大小";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function fileType(file) {
  const ext = (file.extension || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return { label: "图片", badge: "IMG", style: "image" };
  if (["zip", "7z", "rar", "tar", "gz", "bz2"].includes(ext)) return { label: "压缩包", badge: "ZIP", style: "archive" };
  if (["js", "ts", "py", "java", "go", "rs", "html", "css", "json", "xml", "yml", "yaml", "md"].includes(ext)) return { label: "代码", badge: "CODE", style: "code" };
  return { label: ext ? ext.toUpperCase() : "文件", badge: ext ? ext.slice(0, 4).toUpperCase() : "FILE", style: "" };
}

function previewKind(file) {
  const ext = (file.extension || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "json", "xml", "yaml", "yml", "js", "ts", "jsx", "tsx", "py", "java",
    "go", "rs", "c", "h", "cpp", "hpp", "cs", "sh", "bat", "ps1", "css", "html", "log", "ini",
    "toml", "sql", "diff"].includes(ext)) return "text";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (["mp4", "webm", "ogv"].includes(ext)) return "video";
  return "";
}

function previewLimit(kind) {
  return PREVIEW_LIMITS[kind === "audio" || kind === "video" ? "media" : kind] || 0;
}

function clearPreview() {
  if (previewRequest) previewRequest.abort();
  previewRequest = null;
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = "";
  previewContent.replaceChildren();
}

function showPreviewError(message, file) {
  const text = document.createElement("p");
  text.className = "preview-placeholder";
  text.textContent = message;
  previewContent.replaceChildren(text);
  previewMeta.textContent = file ? `${formatSize(file.size)} · 预览失败` : "预览失败";
}

async function readPreviewBlob(response, maxSize) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    throw new Error(`文件超过 ${formatSize(maxSize)} 的预览上限`);
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxSize) throw new Error(`文件超过 ${formatSize(maxSize)} 的预览上限`);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxSize) {
        await reader.cancel();
        throw new Error(`文件超过 ${formatSize(maxSize)} 的预览上限`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
}

async function openPreview(file) {
  const kind = previewKind(file);
  const maxSize = previewLimit(kind);
  if (!kind || !maxSize || file.size > maxSize) return;

  clearPreview();
  previewTitle.textContent = file.name;
  previewPath.textContent = file.path;
  previewMeta.textContent = `${formatSize(file.size)} · ${kind === "text" ? "文本预览" : "浏览器媒体预览"}`;
  previewDownload.href = downloadFileUrl(file);
  previewDownload.download = file.name;
  const loading = document.createElement("p");
  loading.className = "preview-placeholder";
  loading.textContent = "正在加载预览…";
  previewContent.append(loading);
  if (!previewDialog.open) previewDialog.showModal();

  const request = new AbortController();
  previewRequest = request;
  const timeout = window.setTimeout(() => request.abort(), 15_000);
  try {
    const response = await fetch(downloadFileUrl(file), { signal: request.signal });
    if (!response.ok) throw new Error(`文件请求失败 (${response.status})`);
    const blob = await readPreviewBlob(response, maxSize);
    if (request.signal.aborted || previewRequest !== request || !previewDialog.open) return;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(blob);

    let element;
    if (kind === "text") {
      let text = await blob.text();
      if (file.extension.toLowerCase() === "json") {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // Show malformed JSON as plain text rather than hiding the source.
        }
      }
      element = document.createElement("pre");
      element.className = "preview-text";
      element.textContent = text;
    } else if (kind === "image") {
      element = document.createElement("img");
      element.className = "preview-image";
      element.alt = file.name;
      element.src = previewObjectUrl;
      element.addEventListener("error", () => showPreviewError("图片无法显示，可能格式不受浏览器支持。", file), { once: true });
    } else if (kind === "pdf") {
      element = document.createElement("iframe");
      element.className = "preview-frame";
      element.title = `${file.name} PDF 预览`;
      element.src = previewObjectUrl;
    } else {
      element = document.createElement(kind);
      element.className = "preview-media";
      element.controls = true;
      element.preload = "metadata";
      element.src = previewObjectUrl;
      element.addEventListener("error", () => showPreviewError("媒体无法播放，可能编码格式不受浏览器支持。", file), { once: true });
    }
    previewContent.replaceChildren(element);
  } catch (error) {
    if (previewRequest !== request) return;
    if (error.name === "AbortError") {
      showPreviewError("预览请求超时或已取消，请下载文件后使用本地应用打开。", file);
    } else {
      showPreviewError(error.message || "无法加载此文件预览。", file);
    }
  } finally {
    window.clearTimeout(timeout);
    if (previewRequest === request) previewRequest = null;
  }
}

async function loadFiles() {
  const subtitle = document.querySelector("#library-subtitle");
  const refreshButton = document.querySelector("#refresh-button");
  subtitle.textContent = "正在加载文件索引…";
  refreshButton.disabled = true;
  refreshButton.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`${config.filesIndexUrl}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`索引请求失败 (${response.status})`);
    const manifest = await response.json();
    if (!Array.isArray(manifest.files)) throw new Error("文件索引格式无效");
    files = manifest.files.filter((file) => typeof file.name === "string" && typeof file.downloadUrl === "string");
    visibleLimit = 50;
    document.querySelector("#repo-label").textContent = manifest.repository || "";
    document.querySelector("#file-count").textContent = String(files.length);
    subtitle.textContent = manifest.generatedAt
      ? `共 ${files.length} 个文件 · 索引更新于 ${formatDate(manifest.generatedAt)}`
      : `共 ${files.length} 个文件`;
    populateTypeFilter();
    renderFiles();
  } catch (error) {
    files = [];
    document.querySelector("#file-count").textContent = "—";
    subtitle.textContent = "无法读取文件索引";
    document.querySelector("#empty-title").textContent = "文件索引加载失败";
    document.querySelector("#empty-description").textContent = error.message || "请检查网络连接后重试。";
    fileList.replaceChildren();
    document.querySelector("#load-more").hidden = true;
    emptyState.hidden = false;
  } finally {
    refreshButton.disabled = false;
    refreshButton.removeAttribute("aria-busy");
  }
}

function populateTypeFilter() {
  const selected = typeFilter.value;
  const types = [...new Set(files.map((file) => file.extension || "other"))].sort((a, b) => a.localeCompare(b));
  typeFilter.replaceChildren(new Option("所有类型", ""));
  for (const extension of types) {
    const option = new Option(extension === "other" ? "其他" : extension.toUpperCase(), extension);
    typeFilter.append(option);
  }
  if (types.includes(selected)) typeFilter.value = selected;
}

function visibleFiles() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const extension = typeFilter.value;
  const result = files.filter((file) => {
    const matchesType = !extension || (file.extension || "other") === extension;
    const matchesSearch = !query || `${file.name} ${file.path} ${file.extension || ""}`.toLocaleLowerCase().includes(query);
    return matchesType && matchesSearch;
  });
  const compareText = (a, b) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
  result.sort((a, b) => {
    switch (sortOrder.value) {
      case "name-desc": return compareText(b.name, a.name);
      case "updated-desc": return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || compareText(a.name, b.name);
      case "size-desc": return (b.size || 0) - (a.size || 0) || compareText(a.name, b.name);
      case "size-asc": return (a.size || 0) - (b.size || 0) || compareText(a.name, b.name);
      default: return compareText(a.name, b.name);
    }
  });
  return result;
}

function renderFiles() {
  const visible = visibleFiles();
  const shown = visible.slice(0, visibleLimit);
  fileList.replaceChildren();
  emptyState.hidden = visible.length > 0;
  const loadMoreButton = document.querySelector("#load-more");
  loadMoreButton.hidden = visible.length <= shown.length;
  loadMoreButton.textContent = `显示更多文件（${visible.length - shown.length}）`;
  if (visible.length === 0) {
    document.querySelector("#empty-title").textContent = files.length ? "没有找到文件" : "暂无可下载文件";
    document.querySelector("#empty-description").textContent = files.length
      ? "试试其他关键词或清除筛选条件。"
      : "文件添加到下载源仓库后，索引会自动更新。";
  }

  const fragment = document.createDocumentFragment();
  for (const file of shown) {
    const type = fileType(file);
    const row = document.createElement("article");
    row.className = "file-row";

    const main = document.createElement("div");
    main.className = "file-main";
    const badge = document.createElement("span");
    badge.className = `file-icon${type.style ? ` type-${type.style}` : ""}`;
    badge.textContent = type.badge;
    badge.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "file-copy";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.path;
    const path = document.createElement("div");
    path.className = "file-path";
    path.textContent = file.path;
    copy.append(name, path);
    main.append(badge, copy);

    const size = document.createElement("span");
    size.className = "file-meta size-meta";
    size.textContent = formatSize(file.size);
    const updated = document.createElement("span");
    updated.className = "file-meta updated-meta";
    updated.textContent = formatDate(file.updatedAt);
    const fileTypeLabel = document.createElement("span");
    fileTypeLabel.className = "file-type";
    fileTypeLabel.textContent = type.label;
    const download = document.createElement("button");
    download.className = "button download-button";
    download.type = "button";
    download.textContent = "↓ 下载";
    download.addEventListener("click", () => downloadFile(file));

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const kind = previewKind(file);
    const preview = document.createElement("button");
    preview.className = "button preview-button";
    preview.type = "button";
    preview.textContent = "预览";
    preview.disabled = !kind || file.size > previewLimit(kind);
    preview.title = !kind ? "此文件类型暂不支持预览"
      : preview.disabled ? `文件超过 ${formatSize(previewLimit(kind))} 的预览上限` : `预览 ${file.name}`;
    preview.setAttribute("aria-label", `预览 ${file.name}`);
    preview.addEventListener("click", () => openPreview(file));
    actions.append(preview, download);

    row.append(main, size, updated, fileTypeLabel, actions);
    fragment.append(row);
  }
  fileList.append(fragment);
}

function resetFilePage() {
  visibleLimit = 50;
  renderFiles();
}

function updateDownloadStatus(message) {
  downloadStatus.hidden = false;
  document.querySelector("#download-message").textContent = message;
}

function downloadFileUrl(file) {
  try {
    const url = new URL(file.downloadUrl, document.baseURI);
    const downloadsRoot = new URL("./downloads/", document.baseURI);
    if (url.origin !== location.origin || !url.pathname.startsWith(downloadsRoot.pathname)) {
      throw new Error("不支持的下载地址");
    }
    return url.href;
  } catch (error) {
    throw new Error(error.message || "下载地址无效");
  }
}

function downloadFile(file) {
  try {
    const url = downloadFileUrl(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    updateDownloadStatus(`已开始下载 ${file.name}。下载进度、暂停和续传由浏览器下载管理器处理。`);
  } catch (error) {
    updateDownloadStatus(`下载启动失败：${error.message || "请稍后重试"}`);
  }
}

async function start() {
  showLockScreen();
  setAuthFormEnabled(false);
  setAuthMessage("正在加载验证配置…");
  const retryButton = document.querySelector("#config-retry");
  retryButton.hidden = true;
  retryButton.disabled = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("./config.json", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`配置加载失败 (${response.status})`);
    config = await response.json();
    if (typeof config.accessKey !== "string" || !Number.isFinite(config.sessionTtlHours)
        || typeof config.filesIndexUrl !== "string") {
      throw new Error("网站配置无效");
    }
    setAuthFormEnabled(true);
    setAuthMessage("");
    if (isUnlocked()) openSite();
  } catch (error) {
    setAuthFormEnabled(false);
    setAuthMessage(error.name === "AbortError"
      ? "加载验证配置超时，请检查网络连接后重试。"
      : `无法加载验证配置：${error.message || "请检查网络连接后重试。"}`);
    retryButton.hidden = false;
  } finally {
    retryButton.disabled = false;
    window.clearTimeout(timeout);
  }
}

start();
