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

公开下载源无需额外凭证。私有下载源必须给网站仓库配置名为 `DOWNLOAD_SOURCE_TOKEN` 的 Actions secret，令牌仅需对下载源有只读权限。构建会将索引文件复制到 Pages 站点的 `downloads/` 目录，因此这些文件会随公开站点一起公开；**不要配置任何不适合公开发布的文件**。

若使用独立下载源并希望每次推送立即触发网站重建，可将 [`docs/notify-download-site.yml.example`](docs/notify-download-site.yml.example) 复制到下载源仓库的 `.github/workflows/notify-download-site.yml`，并在源仓库 Actions secrets 中设置 `SITE_SYNC_TOKEN`。该令牌需要对网站仓库有 `contents: write` 权限以发送 `repository_dispatch`。未配置通知时，网站仍会在每小时计划任务中同步。

## 访问门禁与安全边界

网站访问密钥和上传密钥以带盐 PBKDF2-SHA-256 哈希保存于 Cloudflare D1，不再放在公开的 `site/config.json`。Worker 对密钥验证实施按 IP 限流；验证通过后，浏览器仅在当前标签页保存 12 小时的解锁状态。`site/config.json` 中的 `apiUrl` 指向 Worker HTTPS 根地址。旧访问密钥曾经存在于公开配置和 Git 历史中，部署前必须通过 setup 脚本换成新的高强度密钥。

**重要：此站点部署在公开 GitHub Pages 上，已发布的文件对所有人可见；登录只限制界面访问，不能保护公开内容。切勿上传机密文件。**

登录页使用 `noindex` / `robots.txt` 提示搜索引擎不收录，并加入隐藏蜜罐、颜色辨识算术题、时间校验、一次性验证码及 D1 服务端密钥验证。颜色题每次随机选择两种颜色及加减运算，每张数字卡片使用互不重复的颜色，并在数字上叠加干扰线；登录背景图片位于 `site/assets/login-background.png`。验证码弹窗可通过“复制并关闭”将验证码复制到剪贴板。

## 文件索引和下载

- `scripts/generate-index.mjs` 根据下载源仓库已跟踪文件生成 `site/data/files.json`，并将文件复制到 `site/downloads/`；下载使用同源 Pages 地址，不再依赖浏览器直连 `raw.githubusercontent.com`。
- 可选的 Cloudflare Worker 上传服务见 `workers/file-upload-worker.js`。网站访问密钥和上传密钥以带盐 PBKDF2-SHA-256 哈希保存于 D1；上传文件通过 GitHub Contents API 提交到 `uploads/`，随后由现有 Pages 工作流生成索引并发布。GitHub fine-grained token 仅需对网站仓库有 Contents 写入权限，并必须用 `wrangler secret put GITHUB_TOKEN` 设置为 Worker secret；不得放进 D1、网页配置或仓库文件。
- 初始化：在 Cloudflare 创建 D1 数据库 `cloudg-credentials`，将数据库 ID 写入 `workers/wrangler.toml`，并在 `workers/` 目录运行 `npx wrangler d1 migrations apply cloudg-credentials --remote`。运行 `node setup-keys.mjs`，在终端提示中设置新的高强度网站访问密钥和上传密钥（至少 16 个字符）；脚本仅将 PBKDF2 盐值和哈希写入本地忽略文件 `workers/generated-keys.sql`，然后运行 `npx wrangler d1 execute cloudg-credentials --remote --file generated-keys.sql`。不要提交生成的 SQL 文件。
- 设置 `workers/wrangler.toml` 的 `ALLOWED_ORIGINS` 为 Pages 网站来源（逗号分隔的 origin，不含路径），运行 `npx wrangler secret put GITHUB_TOKEN` 和 `npx wrangler deploy`。把 Worker 的 HTTPS 根地址填入 `site/config.json` 的 `apiUrl` 后发布 Pages。网站和上传密钥都在 D1 校验；上传使用独立上传密钥。每个文件上限为 10 MiB，以适配 Worker 和 GitHub Contents API 的请求体内存开销。
- 上传后的文件会提交到仓库的 `uploads/` 目录，并在 Pages 工作流重建索引后显示。仓库及 Pages 上的文件是公开的；不要上传私密内容。
- 文件列表支持搜索、类型筛选及名称、更新时间、文件大小排序；页面使用文本节点展示仓库内容，避免将文件名作为 HTML 执行。
- 下载直接交给浏览器原生下载管理器，避免 JavaScript 逐块读取并写盘造成的速度开销；浏览器负责显示实时进度、暂停和续传。下载链接为 Pages 同源地址，不需要额外访问 GitHub 原始文件域名。
- 文件列表为常见图片、PDF、文本/代码、音频和视频提供安全预览；文本按纯文本显示，不执行 HTML/Markdown 内容。预览通过同源请求加载，超过类型大小上限时禁用预览按钮，仍可下载原文件。
- 文件索引在解锁后才请求；网站静态资源和同源下载文件并未因此受到保护。

## 本地预览

使用任意静态文件服务器将 `site/` 作为网站根目录提供服务（例如 `python -m http.server 8000 --directory site`），然后访问 `http://localhost:8000`。本地仓库索引可通过 `node scripts/generate-index.mjs --source . --repository XSVICYYDS/CloudG --ref main` 重新生成。
