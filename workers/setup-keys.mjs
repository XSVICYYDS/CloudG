import { pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const iterations = 120_000;
const outputPath = fileURLToPath(new URL("./generated-keys.sql", import.meta.url));

function readSecret(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this script in an interactive terminal so key input can be masked.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(false);
      stdout.write("\r\n");
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Key setup cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        if (value.length < 16) {
          reject(new Error("Keys must be at least 16 characters."));
        } else {
          resolve(value);
        }
      } else if (key.name === "backspace") {
        if (value.length) {
          value = [...value].slice(0, -1).join("");
          stdout.write("\b \b");
        }
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
        stdout.write("*");
      }
    };
    stdin.on("keypress", onKeypress);
  });
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createRow(role, key) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(key, salt, iterations, 32, "sha256");
  return `  (${sqlString(role)}, ${sqlString(salt.toString("base64"))}, ${sqlString(hash.toString("base64"))}, ${iterations}, unixepoch())`;
}

try {
  process.stdin.setEncoding("utf8");
  const { emitKeypressEvents } = await import("node:readline");
  emitKeypressEvents(process.stdin);
  const siteAccessKey = await readSecret("New website access key (min 16 characters): ");
  const uploadKey = await readSecret("New upload key (min 16 characters): ");
  const sql = `INSERT INTO access_keys (role, salt, key_hash, iterations, created_at)\nVALUES\n${createRow("site_access", siteAccessKey)},\n${createRow("upload", uploadKey)}\nON CONFLICT(role) DO UPDATE SET\n  salt = excluded.salt,\n  key_hash = excluded.key_hash,\n  iterations = excluded.iterations,\n  created_at = excluded.created_at;\n`;
  await writeFile(outputPath, sql, { mode: 0o600 });
  console.log("Created generated-keys.sql with salted PBKDF2 hashes only.");
  console.log("Apply it with Wrangler, then securely delete the generated SQL file.");
} catch (error) {
  console.error(error.message || "Key setup failed.");
  process.exitCode = 1;
}
