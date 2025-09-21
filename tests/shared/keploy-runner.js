import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, isAbsolute, join, delimiter, dirname, extname } from "node:path";

const cache = new Map();

const CONFIG_EXTENSIONS = new Set([".yaml", ".yml"]);

async function ensureConfigFileExists(configDir) {
  const candidateDir = isAbsolute(configDir) ? configDir : resolve(process.cwd(), configDir);
  const candidates = ["keploy.yaml", "keploy.yml"];
  for (const name of candidates) {
    const path = join(candidateDir, name);
    try {
      await access(path, constants.R_OK);
      return;
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      if (err?.code === "EACCES") continue;
      throw err;
    }
  }

  throw new Error(
    `Keploy config not found under "${candidateDir}". Expected keploy.yaml or keploy.yml; update configPath or follow docs/bmad/architecture/tech-stack.md to generate the config.`
  );
}

function normalizeConfigPath(configPath) {
  if (!configPath) return "config";
  const trimmed = configPath.trim();
  if (!trimmed) return "config";
  const extension = extname(trimmed).toLowerCase();
  if (CONFIG_EXTENSIONS.has(extension)) {
    const dir = dirname(trimmed);
    return dir && dir !== "." ? dir : ".";
  }
  return trimmed;
}

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
  configPath = "config/keploy.yaml",
  extraEnv = {},
} = {}) {
  if (!isKeployEnabled()) return { skipped: true };
  if (cache.has(label)) return cache.get(label);

  const runPromise = (async () => {
    const binary = process.env.KEPLOY_BIN || "keploy";
    await ensureBinaryExists(binary);

    const configDir = normalizeConfigPath(configPath);
    await ensureConfigFileExists(configDir);

    const args = ["test", "--config-path", configDir];

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
