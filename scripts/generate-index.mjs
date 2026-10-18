import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (key.startsWith("--") && process.argv[i + 1]) args.set(key.slice(2), process.argv[++i]);
}

const sourceDir = path.resolve(repoRoot, args.get("source") || ".");
const repository = args.get("repository") || process.env.GITHUB_REPOSITORY || "";
const ref = args.get("ref") || process.env.GITHUB_REF_NAME || "main";
const subdir = (args.get("subdir") || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
const defaultIgnore = [".git/", ".github/", "site/", "scripts/", "docs/", "README.md", "LICENSE"];
const ignore = (args.get("ignore") || defaultIgnore.join(","))
  .split(",").map((item) => item.trim().replaceAll("\\", "/")).filter(Boolean);
const outputPath = path.join(repoRoot, "site", "data", "files.json");
const downloadsDir = path.join(repoRoot, "site", "downloads");

function isIgnored(filePath) {
  return ignore.some((item) => item.endsWith("/")
    ? filePath === item.slice(0, -1) || filePath.startsWith(item)
    : filePath === item || filePath.startsWith(`${item}/`));
}

function latestCommitDate(filePath) {
  return execFileSync("git", ["-C", sourceDir, "log", "-1", "--format=%cI", "--", filePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim() || null;
}

async function isGitTracked() {
  return execFileSync("git", ["-C", sourceDir, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
}

function downloadUrl(filePath) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `./downloads/${encodedPath}`;
}

if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error(`无效的 GitHub 仓库名称：${repository || "(空)"}`);
}

const trackedFiles = await isGitTracked();
const files = [];
await rm(downloadsDir, { recursive: true, force: true });
for (const gitPath of trackedFiles) {
  const normalizedPath = gitPath.replaceAll("\\", "/");
  if (subdir && normalizedPath !== subdir && !normalizedPath.startsWith(`${subdir}/`)) continue;
  const relativePath = subdir ? normalizedPath.slice(subdir.length).replace(/^\/+/, "") : normalizedPath;
  if (!relativePath || isIgnored(normalizedPath)) continue;
  const extension = path.posix.extname(relativePath).slice(1).toLowerCase();

  const absolutePath = path.resolve(sourceDir, ...normalizedPath.split("/"));
  if (!absolutePath.startsWith(`${sourceDir}${path.sep}`)) {
    throw new Error(`源文件路径超出仓库目录：${normalizedPath}`);
  }
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) continue;
  const outputFile = path.resolve(downloadsDir, ...relativePath.split("/"));
  if (!outputFile.startsWith(`${downloadsDir}${path.sep}`)) {
    throw new Error(`下载文件路径无效：${relativePath}`);
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await copyFile(absolutePath, outputFile);
  files.push({
    name: path.posix.basename(relativePath),
    path: relativePath,
    size: fileStat.size,
    updatedAt: latestCommitDate(normalizedPath),
    extension,
    downloadUrl: downloadUrl(normalizedPath)
  });
}

files.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true, sensitivity: "base" }));
const manifest = {
  repository,
  ref,
  generatedAt: new Date().toISOString(),
  files
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${files.length} file entries for ${repository}@${ref} -> ${path.relative(repoRoot, outputPath)}`);
