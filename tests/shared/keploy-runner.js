import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const cache = new Map();

export function isKeployEnabled() {
  const raw = process.env.KEPLOY_ENABLED ?? "";
  return /^(1|true|yes)$/i.test(raw.trim());
}

async function ensureBinaryExists(binary) {
  try {
    const candidate = resolve(process.cwd(), binary);
    await access(candidate)
      .then(() => candidate)
      .catch(() => access(binary));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(
        `Keploy CLI not found (looked for "${binary}"). Install via "curl --silent -O -L https://keploy.io/install.sh && source install.sh" or set KEPLOY_BIN.`
      );
    }
    throw err;
  }
}

export async function runKeploySuite({
  label = "default",
  configPath = "config/keploy.yml",
  extraEnv = {},
} = {}) {
  if (!isKeployEnabled()) return { skipped: true };
  if (cache.has(label)) return cache.get(label);

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

  const child = spawn(binary, args, {
    env,
    stdio: "inherit",
  });

  const [code] = await once(child, "exit");
  const result = { exitCode: code, ran: true };
  cache.set(label, result);
  if (code !== 0) {
    throw new Error(`Keploy suite ${label} failed with exit code ${code}`);
  }
  return result;
}
