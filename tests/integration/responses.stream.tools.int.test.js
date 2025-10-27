import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { parseSSE } from "../shared/transcript-utils.js";

let PORT;
let child;

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      PROXY_PROTECT_MODELS: "false",
      CODEX_BIN: "scripts/fake-codex-proto-tools.js",
      PROXY_STOP_AFTER_TOOLS: "true",
      PROXY_STOP_AFTER_TOOLS_MODE: "first",
      PROXY_SSE_KEEPALIVE_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(async () => {
  try {
    if (child && !child.killed) child.kill("SIGTERM");
  } catch {}
});

const collectDeltas = (entries) =>
  entries
    .filter((entry) => entry?.type === "data" && entry.event === "response.output_text.delta")
    .map((entry) => entry.data?.delta || "")
    .join("");

const collectFinalText = (entries) => {
  const completed = entries.find(
    (entry) => entry?.type === "data" && entry.event === "response.completed"
  );
  if (!completed?.data?.response) return "";
  const outputs = Array.isArray(completed.data.response.output)
    ? completed.data.response.output
    : [];
  return outputs
    .flatMap((node) => (Array.isArray(node?.content) ? node.content : []))
    .filter(
      (content) => content && content.type === "output_text" && typeof content.text === "string"
    )
    .map((content) => content.text)
    .join("\n");
};

test("stop-after-tools cuts trailing text for responses streaming", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/responses?stream=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-sk-ci" },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
  });

  expect(res.ok).toBeTruthy();
  const raw = await res.text();
  const entries = parseSSE(raw);
  const deltas = collectDeltas(entries);
  expect(deltas).toContain("<use_tool>");
  expect(deltas).not.toContain("AFTER_TOOL_TEXT");

  const finalText = collectFinalText(entries);
  expect(finalText).toContain("<use_tool>");
  expect(finalText).not.toContain("AFTER_TOOL_TEXT");
});
