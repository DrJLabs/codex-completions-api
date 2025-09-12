import { spawn } from "node:child_process";
import path from "node:path";
import { config as CFG } from "../config/index.js";

const CODEX_BIN = CFG.CODEX_BIN;
export const resolvedCodexBin = path.isAbsolute(CODEX_BIN)
  ? CODEX_BIN
  : CODEX_BIN.includes(path.sep)
    ? path.join(process.cwd(), CODEX_BIN)
    : CODEX_BIN;

export const codexHome = CFG.CODEX_HOME;
export const codexWorkdir = CFG.PROXY_CODEX_WORKDIR;

export function spawnCodex(args = [], options = {}) {
  const child = spawn(resolvedCodexBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME: codexHome, ...(options.env || {}) },
    cwd: options.cwd || codexWorkdir,
  });
  try {
    child.stdout.setEncoding && child.stdout.setEncoding("utf8");
  } catch {}
  try {
    child.stderr.setEncoding && child.stderr.setEncoding("utf8");
  } catch {}
  return child;
}
