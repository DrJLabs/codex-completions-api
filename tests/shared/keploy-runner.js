import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, isAbsolute, join, delimiter } from "node:path";

const cache = new Map();

export function isKeployEnabled() {
  const raw = process.env.KEPLOY_ENABLED ?? "";
  return /^(1|true|yes)$/i.test(raw.trim());
}

async function ensureBinaryExists(binary) {
  const hasPathSeparator = binary.includes("/") || binary.includes("\\");
  if (hasPathSeparator || isAbsolute(binary)) {
    const candidate = isAbsolute(binary) ? binary : resolve(process.cwd(), binary);
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch (err) {
      if (err?.code === "ENOENT") {
        throw new Error(
          `Keploy CLI not found at "${candidate}". Please follow the installation steps documented in docs/bmad/architecture/tech-stack.md and set KEPLOY_BIN if using a non-default path.`
        );
      }
      throw err;
    }
  }

  const searchPath = process.env.PATH ?? "";
  for (const segment of searchPath.split(delimiter)) {
    if (!segment) continue;
    const candidate = join(segment, binary);
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "EACCES") continue;
      throw err;
    }
  }

  throw new Error(
    `Keploy CLI not found on PATH (looked for "${binary}"). Please follow the installation steps documented in docs/bmad/architecture/tech-stack.md and set KEPLOY_BIN if using a non-default path.`
  );
}

export async function runKeploySuite({
  label = "default",
  configPath = "config/keploy.yml",
  extraEnv = {},
} = {}) {
  if (!isKeployEnabled()) return { skipped: true };
  if (cache.has(label)) return cache.get(label);

  const runPromise = (async () => {
    const binary = process.env.KEPLOY_BIN || "keploy";
    await ensureBinaryExists(binary);

    const args = ["test", "--config-path", configPath];

    const env = {
      ...process.env,
      PROXY_API_KEY: process.env.PROXY_API_KEY || "test-sk-ci",
      CODEX_BIN: process.env.CODEX_BIN || "scripts/fake-codex-proto.js",
      PORT: process.env.KEPLOY_APP_PORT || "11435",
      ...extraEnv,
    };

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env,
        stdio: "inherit",
      });

      child.once("error", (err) => {
        reject(new Error(`Failed to launch Keploy CLI for ${label}: ${err.message}`));
      });

      child.once("exit", (code) => {
        const exitCode = typeof code === "number" ? code : 0;
        if (exitCode !== 0) {
          reject(new Error(`Keploy suite ${label} failed with exit code ${exitCode}`));
          return;
        }
        resolve({ exitCode, ran: true });
      });
    });
  })();

  cache.set(label, runPromise);
  try {
    return await runPromise;
  } catch (err) {
    cache.delete(label);
    throw err;
  }
}
