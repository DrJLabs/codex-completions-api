#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";

const RAW_DIR =
  process.env.COPILOT_CAPTURE_DIR ||
  path.join(process.cwd(), "test-results", "responses-copilot", "raw");
const FIXTURE_DIR =
  process.env.COPILOT_FIXTURE_DIR ||
  path.join(process.cwd(), "tests", "fixtures", "obsidian-copilot", "responses");

const PLACEHOLDERS = {
  req_id: "<req-id>",
  trace_id: "<trace-id>",
  copilot_trace_id: "<copilot-trace-id>",
  response_id: "<response-id>",
  item_id: "<item-id>",
  message_id: "<message-id>",
  previous_response_id: "<previous-response-id>",
  id: "<id>",
};

const isPlainObject = (value) =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);

const normalizeValue = (value, key = "") => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (Object.prototype.hasOwnProperty.call(PLACEHOLDERS, key)) {
      return PLACEHOLDERS[key];
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, key));
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    next[entryKey] = normalizeValue(entryValue, entryKey);
  }
  return next;
};

const normalizeCapture = (payload) => normalizeValue(payload);

const resolveScenarioName = (payload, filename) => {
  const raw = payload?.metadata?.scenario || filename.replace(/\.json$/i, "");
  return String(raw).trim() || filename.replace(/\.json$/i, "");
};

const hasToolEvents = (payload) =>
  Array.isArray(payload?.stream) &&
  payload.stream.some((entry) => String(entry?.event || "").includes("response.output_item"));

const isStreamCapture = (payload) =>
  Boolean(payload?.metadata?.stream ?? payload?.request?.body?.stream);

async function clearOldFixtures() {
  try {
    const entries = await readdir(FIXTURE_DIR);
    await Promise.all(
      entries
        .filter((file) => file.endsWith(".json") && file !== "manifest.json")
        .map((file) => unlink(path.join(FIXTURE_DIR, file)))
    );
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

async function main() {
  const files = (await readdir(RAW_DIR)).filter((file) => file.endsWith(".json"));
  if (files.length === 0) {
    console.error(`[copilot-capture] no files found in ${RAW_DIR}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(FIXTURE_DIR, { recursive: true });
  await clearOldFixtures();

  const manifest = {
    source: "proxy-capture",
    generated_at: new Date().toISOString(),
    fixtures: [],
  };

  let streamTool = null;
  let streamText = null;
  let nonstream = null;

  for (const file of files) {
    let payload;
    try {
      const raw = await readFile(path.join(RAW_DIR, file), "utf8");
      payload = JSON.parse(raw);
    } catch (err) {
      const message = err && typeof err === "object" ? err.message : String(err || "");
      console.error(`[copilot-capture] skipping malformed file: ${file}`, message);
      continue;
    }
    const normalized = normalizeCapture(payload);
    const isStream = isStreamCapture(payload);
    const toolEvents = hasToolEvents(payload);

    if (!isStream && !nonstream) {
      nonstream = { payload: normalized, source: resolveScenarioName(payload, file) };
      continue;
    }
    if (isStream && toolEvents && !streamTool) {
      streamTool = { payload: normalized, source: resolveScenarioName(payload, file) };
      continue;
    }
    if (isStream && !toolEvents && !streamText) {
      streamText = { payload: normalized, source: resolveScenarioName(payload, file) };
    }
  }

  const fixtures = [
    nonstream && {
      file: "responses-nonstream.json",
      scenario: "responses-nonstream",
      capture_source: nonstream.source,
      payload: nonstream.payload,
    },
    streamText && {
      file: "responses-stream-text.json",
      scenario: "responses-stream-text",
      capture_source: streamText.source,
      payload: streamText.payload,
    },
    streamTool && {
      file: "responses-stream-tool.json",
      scenario: "responses-stream-tool",
      capture_source: streamTool.source,
      payload: streamTool.payload,
    },
  ].filter(Boolean);

  if (!streamText || !streamTool) {
    console.error("[copilot-capture] missing required stream captures (text/tool)");
    process.exitCode = 1;
    return;
  }

  for (const fixture of fixtures) {
    await writeFile(
      path.join(FIXTURE_DIR, fixture.file),
      `${JSON.stringify(fixture.payload, null, 2)}\n`,
      "utf8"
    );
    manifest.fixtures.push({
      file: fixture.file,
      scenario: fixture.scenario,
      capture_source: fixture.capture_source,
    });
  }

  await writeFile(
    path.join(FIXTURE_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

main().catch((err) => {
  console.error("[copilot-capture] failed to normalize fixtures", err);
  process.exitCode = 1;
});
