#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const fixturePath = process.env.PROTO_FIXTURE_PATH;
const replayDelayMs = Number(process.env.PROTO_FIXTURE_DELAY_MS ?? 5);

if (!fixturePath) {
  console.error("[replay-fixture] PROTO_FIXTURE_PATH is required");
  process.exit(1);
}

const resolveFixturePath = (input) => {
  if (path.isAbsolute(input)) return input;
  return path.resolve(process.cwd(), input);
};

async function loadFixtureLines(filePath) {
  // Fixture paths come from trusted test inputs; non-literal fs access is intentional here.
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function replay() {
  const resolvedPath = resolveFixturePath(fixturePath);
  let lines;
  try {
    lines = await loadFixtureLines(resolvedPath);
  } catch (error) {
    console.error("[replay-fixture] failed to load fixture", error?.message || error);
    process.exit(1);
  }

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.error("[replay-fixture] invalid JSON in fixture", error?.message || error);
      continue;
    }
    try {
      process.stdout.write(JSON.stringify(parsed) + "\n");
    } catch {}
    if (replayDelayMs > 0) {
      await delay(replayDelayMs);
    }
  }

  await delay(5);
  process.stdout.end?.();
}
/* eslint-enable security/detect-non-literal-fs-filename */

replay().catch((error) => {
  console.error("[replay-fixture] fatal error", error?.stack || error);
  process.exit(1);
});
