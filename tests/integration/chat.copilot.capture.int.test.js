import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";

const CAPTURE_DIR = path.join(process.cwd(), ".tmp-chat-capture");

const listCaptureFiles = async () => {
  try {
    const entries = await fs.readdir(CAPTURE_DIR);
    return entries.filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
};

const readLatestCapture = async () => {
  const files = await listCaptureFiles();
  if (!files.length) return null;
  const sorted = files.slice().sort();
  const file = sorted[sorted.length - 1];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture path under temp test dir
  const raw = await fs.readFile(path.join(CAPTURE_DIR, file), "utf8");
  return JSON.parse(raw);
};

describe("chat capture fixtures", () => {
  let serverCtx;

  beforeAll(async () => {
    await fs.rm(CAPTURE_DIR, { recursive: true, force: true });
    serverCtx = await startServer({
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      FAKE_CODEX_MODE: "tool_call",
      PROXY_CAPTURE_CHAT_TRANSCRIPTS: "true",
      PROXY_CAPTURE_CHAT_DIR: CAPTURE_DIR,
      PROXY_SSE_KEEPALIVE_MS: "0",
      PROXY_OUTPUT_MODE: "obsidian-xml",
    });
  }, 10_000);

  afterAll(async () => {
    if (serverCtx) await stopServer(serverCtx.child);
    await fs.rm(CAPTURE_DIR, { recursive: true, force: true });
  });

  test("captures streaming chat payloads", async () => {
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-sk-ci",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("x-proxy-trace-id")).toBeTruthy();
    await res.text();
    await wait(50);

    const capture = await readLatestCapture();
    expect(capture?.metadata?.stream).toBe(true);
    expect(Array.isArray(capture?.stream)).toBe(true);
  });

  test("captures nonstream chat payloads", async () => {
    const before = await listCaptureFiles();
    const res = await fetch(`http://127.0.0.1:${serverCtx.PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-sk-ci",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("x-proxy-trace-id")).toBeTruthy();
    await res.json();
    await wait(50);

    const after = await listCaptureFiles();
    expect(after.length).toBeGreaterThan(before.length);
    const capture = await readLatestCapture();
    expect(capture?.metadata?.stream).toBe(false);
    expect(capture?.response).toBeTruthy();
  });
});
