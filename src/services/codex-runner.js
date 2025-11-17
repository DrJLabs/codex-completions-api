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
  const {
    reqId = null,
    route = null,
    mode = null,
    env: envOpt,
    cwd: cwdOpt,
    ...spawnOptions
  } = options;
  try {
    // Ensure working directory exists before spawning child process
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- codexWorkdir from config, not request
    fs.mkdirSync(cwdOpt || codexWorkdir, { recursive: true });
  } catch (e) {
    console.error(`[codex-runner] failed to ensure workdir at ${cwdOpt || codexWorkdir}:`, e);
  }
  const childEnv = { ...process.env, CODEX_HOME: codexHome, ...(envOpt || {}) };
  const childCwd = cwdOpt || codexWorkdir;
  const child = spawn(resolvedCodexBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv,
    cwd: childCwd,
    ...spawnOptions,
  });
  const lifecycleBase = {
    req_id: reqId || null,
    route,
    mode,
    pid: child.pid || null,
  };
  try {
    logBackendLifecycle("backend_start", {
      ...lifecycleBase,
      argv: Array.isArray(args) ? args.slice(0, 8) : [],
      cwd: childCwd,
    });
  } catch {}
  child.on("exit", (code, signal) => {
    try {
      logBackendLifecycle("backend_exit", { ...lifecycleBase, code, signal });
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
