import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { parseSSE } from "../shared/transcript-utils.js";
import { startServer, stopServer } from "./helpers.js";

let PORT;
let child;

beforeAll(async () => {
  const server = await startServer({
    PROXY_API_KEY: "test-sk-ci",
    PROXY_PROTECT_MODELS: "false",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    FAKE_CODEX_MODE: "textual_tool_tail",
    PROXY_STOP_AFTER_TOOLS: "true",
    PROXY_STOP_AFTER_TOOLS_MODE: "first",
    PROXY_RESPONSES_OUTPUT_MODE: "obsidian-xml",
    PROXY_SSE_KEEPALIVE_MS: "0",
  });
  PORT = server.PORT;
  child = server.child;
});

afterAll(async () => {
  await stopServer(child);
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
