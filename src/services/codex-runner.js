import { spawn } from "node:child_process";
import path from "node:path";
import { config as CFG } from "../config/index.js";
import fs from "node:fs";
import { logBackendLifecycle } from "../dev-trace/backend.js";

const CODEX_BIN = CFG.CODEX_BIN;
export const resolvedCodexBin = path.isAbsolute(CODEX_BIN)
  ? CODEX_BIN
  : CODEX_BIN.includes(path.sep)
    ? path.join(process.cwd(), CODEX_BIN)
    : CODEX_BIN;

export const codexHome = CFG.CODEX_HOME;
export const codexWorkdir = CFG.PROXY_CODEX_WORKDIR;

export function spawnCodex(args = [], options = {}) {
  try {
    // Ensure working directory exists before spawning child process
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- codexWorkdir from config, not request
    fs.mkdirSync(options.cwd || codexWorkdir, { recursive: true });
  } catch (e) {
    console.error(`[codex-runner] failed to ensure workdir at ${options.cwd || codexWorkdir}:`, e);
  }
  const child = spawn(resolvedCodexBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME: codexHome, ...(options.env || {}) },
    cwd: options.cwd || codexWorkdir,
  });
  try {
    logBackendLifecycle("backend_start", {
      pid: child.pid || null,
      argv: Array.isArray(args) ? args.slice(0, 8) : [],
      cwd: options.cwd || codexWorkdir,
    });
  } catch {}
  child.on("exit", (code, signal) => {
    try {
      logBackendLifecycle("backend_exit", { pid: child.pid || null, code, signal });
    } catch {}
  });
  try {
    child.stdout.setEncoding && child.stdout.setEncoding("utf8");
  } catch {}
  try {
    child.stderr.setEncoding && child.stderr.setEncoding("utf8");
  } catch {}
  return child;
}
