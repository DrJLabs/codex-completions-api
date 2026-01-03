import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const readText = (segments) => {
  const filePath = path.join(process.cwd(), ...segments);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper reads repo fixtures
  return readFile(filePath, "utf8");
};

const extractEnvKeysFromFakeCodex = async () => {
  const content = await readText(["scripts", "fake-codex-jsonrpc.js"]);
  const matches = content.matchAll(/process\.env\.(FAKE_CODEX_[A-Z0-9_]+)/g);
  const keys = new Set();
  for (const match of matches) {
    keys.add(match[1]);
  }
  return keys;
};

const extractBaseEnvKeys = async () => {
  const content = await readText(["scripts", "generate-chat-transcripts.mjs"]);
  const marker = "const BASE_FAKE_CODEX_ENV";
  const start = content.indexOf(marker);
  if (start === -1) return new Set();
  const blockStart = content.indexOf("{", start);
  const blockEnd = content.indexOf("};", blockStart);
  if (blockStart === -1 || blockEnd === -1) return new Set();
  const block = content.slice(blockStart, blockEnd);
  const matches = block.matchAll(/\b(FAKE_CODEX_[A-Z0-9_]+)\b/g);
  const keys = new Set();
  for (const match of matches) {
    keys.add(match[1]);
  }
  return keys;
};

describe("generate-chat-transcripts base env", () => {
  it("includes all FAKE_CODEX env keys used by the fake codex script", async () => {
    const usedKeys = await extractEnvKeysFromFakeCodex();
    const baseKeys = await extractBaseEnvKeys();
    const missing = [...usedKeys].filter((key) => !baseKeys.has(key));

    expect(missing, `Missing FAKE_CODEX keys: ${missing.join(", ")}`).toEqual([]);
  });
});
