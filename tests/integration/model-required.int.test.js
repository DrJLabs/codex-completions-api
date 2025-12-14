import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

let ctx;
let base;

beforeAll(async () => {
  ctx = await startServer();
  base = `http://127.0.0.1:${ctx.PORT}`;
}, 10_000);

afterAll(async () => {
  await stopServer(ctx?.child);
});

const postJson = async (path, body) => {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sk-ci",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
};

test("chat/completions requires model", async () => {
  const missing = await postJson("/v1/chat/completions", {
    stream: false,
    messages: [{ role: "user", content: "hi" }],
  });
  expect(missing.status).toBe(400);
  const missingBody = await missing.json();
  expect(missingBody?.error?.type).toBe("invalid_request_error");
  expect(missingBody?.error?.param).toBe("model");

  const empty = await postJson("/v1/chat/completions", {
    model: "",
    stream: false,
    messages: [{ role: "user", content: "hi" }],
  });
  expect(empty.status).toBe(400);
  const emptyBody = await empty.json();
  expect(emptyBody?.error?.type).toBe("invalid_request_error");
  expect(emptyBody?.error?.param).toBe("model");
});

test("legacy /v1/completions requires model and still accepts prompt-only payloads", async () => {
  const missing = await postJson("/v1/completions", { prompt: "hi", stream: false });
  expect(missing.status).toBe(400);
  const missingBody = await missing.json();
  expect(missingBody?.error?.type).toBe("invalid_request_error");
  expect(missingBody?.error?.param).toBe("model");

  const empty = await postJson("/v1/completions", { model: "", prompt: "hi", stream: false });
  expect(empty.status).toBe(400);
  const emptyBody = await empty.json();
  expect(emptyBody?.error?.type).toBe("invalid_request_error");
  expect(emptyBody?.error?.param).toBe("model");

  const ok = await postJson("/v1/completions", { model: "codex-5", prompt: "hi", stream: false });
  expect(ok.status).toBe(200);
  const okBody = await ok.json();
  expect(okBody?.object).toBe("text_completion");
});
