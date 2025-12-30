import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config as CFG } from "../config/index.js";
import { spawnCodex } from "./codex-runner.js";

const OUTPUT_DIRNAME = "exec-output";

const ensureOutputPath = async () => {
  const dir = path.join(CFG.PROXY_CODEX_WORKDIR, OUTPUT_DIRNAME);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config
  await fs.mkdir(dir, { recursive: true });
  const filename = `exec-${Date.now()}-${nanoid(8)}.txt`;
  return path.join(dir, filename);
};

const readOutputFile = async (outputPath) => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config+nanoid
  const raw = await fs.readFile(outputPath, "utf8");
  return raw.trim();
};

export async function runCodexExec({
  prompt,
  model,
  reqId = null,
  route = null,
  mode = null,
  env = null,
  reasoningEffort = null,
  timeoutMs = null,
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("codex exec requires a non-empty prompt");
  }
  const resolvedReasoning =
    typeof reasoningEffort === "string"
      ? reasoningEffort.trim().toLowerCase()
      : typeof CFG.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT === "string"
        ? CFG.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT.trim().toLowerCase()
        : "";
  const outputPath = await ensureOutputPath();
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    "-m",
    model || CFG.PROXY_TITLE_SUMMARY_EXEC_MODEL || "gpt-5.2",
  ];
  if (resolvedReasoning) {
    args.push("-c", `model_reasoning_effort="${resolvedReasoning}"`);
    args.push("-c", `reasoning.effort="${resolvedReasoning}"`);
  }
  const child = spawnCodex(args, { reqId, route, mode, env });
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : CFG.PROXY_TIMEOUT_MS;

  return await new Promise((resolve, reject) => {
    let stderr = "";
    let timeoutHandle;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };

    if (timeout && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        cleanup();
        reject(new Error("codex exec timed out"));
      }, timeout);
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        if (typeof chunk === "string") {
          stderr += chunk;
        } else if (Buffer.isBuffer(chunk)) {
          stderr += chunk.toString("utf8");
        }
        if (stderr.length > 8192) {
          stderr = stderr.slice(-8192);
        }
      });
    }

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });

    child.on("exit", async (code, signal) => {
      cleanup();
      try {
        if (code !== 0) {
          const suffix = signal ? ` (signal ${signal})` : "";
          throw new Error(
            `codex exec failed with code ${code}${suffix}${stderr ? `: ${stderr}` : ""}`
          );
        }
        const output = await readOutputFile(outputPath);
        if (!output) {
          throw new Error(`codex exec produced empty output${stderr ? `: ${stderr}` : ""}`);
        }
        resolve(output);
      } catch (err) {
        reject(err);
      } finally {
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config+nanoid
          await fs.unlink(outputPath);
        } catch {}
      }
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
