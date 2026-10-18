const AUTH_STATE_KEY = "cloudg-download-auth-v1";
const RATE_LIMIT_KEY = "cloudg-download-rate-v1";
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000;

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
let config;
let files = [];
let visibleLimit = 50;

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

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const wait = remainingLockMs();
  if (wait > 0) {
    setAuthMessage(`尝试次数过多，请${formatWait(wait)}。`);
    return;
  }
  if (authInput.value !== config.accessKey) {
    const state = recordFailure();
    authInput.value = "";
    const newWait = remainingLockMs();
    setAuthMessage(newWait > 0
      ? `尝试次数过多，已暂时锁定。请${formatWait(newWait)}。`
      : `密钥不正确。还可尝试 ${MAX_ATTEMPTS - state.attempts} 次。`);
    authInput.focus();
    return;
  }

  localStorage.removeItem(RATE_LIMIT_KEY);
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
    download.addEventListener("click", () => downloadFile(file, download));

    row.append(main, size, updated, fileTypeLabel, download);
    fragment.append(row);
  }
  fileList.append(fragment);
}

function resetFilePage() {
  visibleLimit = 50;
  renderFiles();
}

function updateDownloadStatus(message, progress, total) {
  downloadStatus.hidden = false;
  document.querySelector("#download-message").textContent = message;
  const progressBar = document.querySelector("#download-progress");
  const label = document.querySelector("#download-progress-label");
  if (Number.isFinite(total) && total > 0) {
    progressBar.removeAttribute("value");
    progressBar.max = total;
    progressBar.value = progress;
    label.textContent = `${formatSize(progress)} / ${formatSize(total)}`;
  } else {
    progressBar.removeAttribute("value");
    label.textContent = formatSize(progress);
  }
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

async function streamToFile(file, handle, button) {
  const existing = await handle.getFile();
  let offset = 0;
  if (existing.name === file.name && existing.size > 0 && existing.size < file.size
      && window.confirm(`发现同名的部分文件（${formatSize(existing.size)}）。是否从断点继续下载？`)) {
    offset = existing.size;
  }

  const writable = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset > 0) await writable.seek(offset);
  let retries = 0;
  try {
    while (offset < file.size) {
      let response;
      try {
        const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
        response = await fetch(downloadFileUrl(file), { headers, cache: "no-store" });
      } catch (error) {
        if (retries >= 3) throw error;
        retries += 1;
        updateDownloadStatus(`网络中断，正在重试（${retries}/3）…`, offset, file.size);
        await new Promise((resolve) => setTimeout(resolve, retries * 700));
        continue;
      }
      if (!response.ok) throw new Error(`下载请求失败 (${response.status})`);
      if (offset > 0 && response.status === 200) {
        await writable.truncate(0);
        offset = 0;
      } else if (offset > 0 && response.status !== 206) {
        throw new Error("下载服务器不支持断点续传");
      }
      const range = response.headers.get("content-range");
      if (response.status === 206 && range && !range.startsWith(`bytes ${offset}-`)) {
        throw new Error("服务器返回的续传范围不匹配");
      }
      if (!response.body) throw new Error("浏览器无法读取下载数据流");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          offset += value.byteLength;
          retries = 0;
          updateDownloadStatus(`正在下载 ${file.name}`, offset, file.size);
        }
      } catch (error) {
        if (retries >= 3) throw error;
        retries += 1;
        await writable.seek(offset);
        updateDownloadStatus(`网络中断，正在续传（${retries}/3）…`, offset, file.size);
        await new Promise((resolve) => setTimeout(resolve, retries * 700));
      } finally {
        reader.releaseLock();
      }
    }
    if (offset !== file.size) throw new Error("文件大小与索引不一致，下载已取消");
    await writable.close();
    updateDownloadStatus(`下载完成：${file.name}`, file.size, file.size);
  } catch (error) {
    await writable.abort();
    throw error;
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

async function downloadFile(file, button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const url = downloadFileUrl(file);
    if ("showSaveFilePicker" in window && file.size > 0) {
      const handle = await window.showSaveFilePicker({ suggestedName: file.name });
      updateDownloadStatus(`准备下载 ${file.name}`, 0, file.size);
      await streamToFile(file, handle, button);
      return;
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = file.name;
    link.click();
    updateDownloadStatus("已交由浏览器下载管理器处理；可在浏览器中查看进度或续传。", 0, 0);
  } catch (error) {
    if (error.name !== "AbortError") {
      updateDownloadStatus(`下载失败：${error.message || "请稍后重试"}`, 0, 0);
    }
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

async function start() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`配置加载失败 (${response.status})`);
    config = await response.json();
    if (typeof config.accessKey !== "string" || !Number.isFinite(config.sessionTtlHours)
        || typeof config.filesIndexUrl !== "string") {
      throw new Error("网站配置无效");
    }
    if (isUnlocked()) openSite();
    else showLockScreen();
  } catch (error) {
    authView.hidden = false;
    document.querySelector("#auth-title").textContent = "网站暂不可用";
    document.querySelector("#auth-form").hidden = true;
    document.querySelector(".auth-card > .muted").textContent = error.message || "无法加载网站配置。";
  }
}

start();
