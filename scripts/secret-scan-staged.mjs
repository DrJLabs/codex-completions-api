import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const listStagedFiles = ({ exec = spawnSync, cwd = process.cwd() } = {}) => {
  const result = exec("git", ["diff", "--name-only", "--cached", "-z", "--diff-filter=ACMR"], {
    cwd,
    encoding: "utf8",
  });
  if (result?.error) {
    throw result.error;
  }
  if (result?.status !== 0) {
    const message = String(result?.stderr || "").trim();
    throw new Error(message || `git diff failed with status ${result.status}`);
  }
  const stdout = String(result?.stdout || "");
  return stdout
    .split("\u0000")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const filterExistingFiles = (files = [], exists = fs.existsSync) =>
  files.filter((file) => exists(file));

export const runSecretlint = ({ files = [], exec = spawnSync, cwd = process.cwd() } = {}) => {
  if (!files.length) return 0;
  const result = exec("npx", ["--no-install", "secretlint", ...files], {
    cwd,
    stdio: "inherit",
  });
  if (result?.error) {
    console.error("[secret-scan] secretlint failed to execute:", result.error);
    return 1;
  }
  return typeof result?.status === "number" ? result.status : 1;
};

export const main = ({ exec = spawnSync, exists = fs.existsSync } = {}) => {
  let stagedFiles = [];
  try {
    stagedFiles = listStagedFiles({ exec });
  } catch (err) {
    console.error("[secret-scan] failed to list staged files:", err?.message || err);
    return 1;
  }
  const files = filterExistingFiles(stagedFiles, exists);
  if (!files.length) {
    console.log("[secret-scan] no staged files to scan");
    return 0;
  }
  return runSecretlint({ files, exec });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = main();
  process.exit(exitCode);
}
