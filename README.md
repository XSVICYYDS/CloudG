# CloudG 文件下载中心

基于原生 HTML、CSS 和 JavaScript 的静态文件浏览、筛选与下载网站，可由 GitHub Actions 自动构建并部署到 GitHub Pages。

## 部署到 GitHub Pages

1. 将本仓库推送到 GitHub 的 `main` 分支。
2. 打开仓库 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
3. 工作流会生成文件索引并部署站点。首次部署完成后，页面地址会显示在 Actions 的部署任务和 Pages 设置中。

默认以本仓库 `main` 分支为下载源，索引包含所有已跟踪的普通文件，并忽略 `.github/`、`site/`、`scripts/`、`docs/`、`README.md` 和 `LICENSE`。修改 `main` 分支会触发重建；每小时也会执行一次同步。

### 使用独立下载源仓库（可选）

在网站仓库的 **Settings → Secrets and variables → Actions → Variables** 中设置：

| 变量 | 用途 |
| --- | --- |
| `DOWNLOAD_REPOSITORY` | 下载源仓库，格式为 `owner/repo`；省略时使用网站仓库 |
| `DOWNLOAD_REF` | 下载源分支；省略时使用触发工作流的分支 |
| `DOWNLOAD_PATH` | 仅索引源仓库中的指定目录；省略时索引仓库根目录 |
| `DOWNLOAD_IGNORE` | 逗号分隔的忽略路径；设置后会替换默认忽略列表 |

公开下载源无需额外凭证。私有下载源必须给网站仓库配置名为 `DOWNLOAD_SOURCE_TOKEN` 的 Actions secret，令牌仅需对下载源有只读权限；浏览器下载直链要求该源仓库及其文件本身可公开访问，因此私有仓库的文件不能通过本静态站匿名下载。

若使用独立下载源并希望每次推送立即触发网站重建，可将 [`docs/notify-download-site.yml.example`](docs/notify-download-site.yml.example) 复制到下载源仓库的 `.github/workflows/notify-download-site.yml`，并在源仓库 Actions secrets 中设置 `SITE_SYNC_TOKEN`。该令牌需要对网站仓库有 `contents: write` 权限以发送 `repository_dispatch`。未配置通知时，网站仍会在每小时计划任务中同步。

## 访问门禁与安全边界

访问密钥配置在 `site/config.json`，默认值为 `Xsvicyyds!12345678`。修改该文件即可更换密钥。验证成功后只在当前标签页的 `sessionStorage` 中保存 12 小时有效的解锁时间戳，不保存密钥；连续输错 5 次会锁定 1 分钟，后续锁定时间逐次翻倍，最长 1 小时。错误计数保存在浏览器本地。

**重要：GitHub Pages 是公开的静态托管服务。前端密钥、页面源代码和公开仓库中的文件均可被访问者查看；客户端锁定逻辑也能被绕过，不能用来保护机密文件或实现服务端鉴权。** 此门禁仅用于普通访问者的界面访问控制。需要真正的资源访问控制时，必须采用后端身份验证及受保护的文件存储。

## 文件索引和下载

- `scripts/generate-index.mjs` 根据下载源仓库已跟踪文件生成 `site/data/files.json`，包含完整相对路径、文件名、大小、最后提交时间、扩展名和 GitHub 原始文件直链。
- 文件列表支持搜索、类型筛选及名称、更新时间、文件大小排序；页面使用文本节点展示仓库内容，避免将文件名作为 HTML 执行。
- 支持文件系统访问 API 的浏览器会流式下载文件、显示实时字节进度，并在连接中断时对支持 Range 的服务器尝试断点续传。其他浏览器会将下载交给浏览器下载管理器，使用其原生进度与续传能力。
- 文件索引在解锁后才请求；网站静态资源和公开仓库直链并未因此受到保护。

## 本地预览

使用任意静态文件服务器将 `site/` 作为网站根目录提供服务（例如 `python -m http.server 8000 --directory site`），然后访问 `http://localhost:8000`。本地仓库索引可通过 `node scripts/generate-index.mjs --source . --repository XSVICYYDS/CloudG --ref main` 重新生成。
