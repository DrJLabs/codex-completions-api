// @ts-check
import { test, expect } from "@playwright/test";
import { readSSE } from "./lib/sse-reader.js";

function parseFrames(frames) {
  return frames
    .filter((d) => d && d.trim() !== "[DONE]")
    .map((d) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    })
    .filter((o) => o && typeof o === "object");
}

function assertEnvelopeAndStability(objs) {
  expect(objs.length).toBeGreaterThan(0);

  for (const o of objs) {
    expect(o.object).toBe("chat.completion.chunk");
    expect(typeof o.id).toBe("string");
    expect(typeof o.created).toBe("number");
    expect(typeof o.model).toBe("string");
    // No custom event frames
    expect("event" in o).toBeFalsy();
  }

  // Stability across frames
  const idSet = new Set(objs.map((o) => o.id));
  const createdSet = new Set(objs.map((o) => o.created));
  const modelSet = new Set(objs.map((o) => o.model));
  expect(idSet.size).toBe(1);
  expect(createdSet.size).toBe(1);
  expect(modelSet.size).toBe(1);
}

test("every JSON frame includes id/object/created/model (no usage)", async ({ baseURL }) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      messages: [{ role: "user", content: "Check envelope fields." }],
    }),
  });

  expect(frames.some((d) => d.trim() === "[DONE]")).toBeTruthy();
  const objs = parseFrames(frames).filter((o) => o.object === "chat.completion.chunk");
  assertEnvelopeAndStability(objs);

  // Intermediate frames: finish_reason and usage are null when present
  // Finalizer has empty delta and a string finish_reason
  const finals = objs.filter((o) => {
    const ch = o.choices?.[0];
    return (
      ch && ch.delta && Object.keys(ch.delta).length === 0 && typeof ch.finish_reason === "string"
    );
  });
  expect(finals.length).toBeGreaterThanOrEqual(1);
  const nonFinals = objs.filter((o) => !finals.includes(o));
  for (const o of nonFinals) {
    const ch = o.choices?.[0];
    const fr = ch ? ch.finish_reason : null;
    expect(fr).toBe(null);
    expect(o.usage ?? null).toBe(null);
  }

  // No usage chunk when include_usage not requested
  const hasUsageChunk = objs.some(
    (o) => Array.isArray(o.choices) && o.choices.length === 0 && o.usage
  );
  expect(hasUsageChunk).toBeFalsy();
});

test("usage chunk also has full envelope and order is finalizer → usage → [DONE]", async ({
  baseURL,
}) => {
  const url = new URL("v1/chat/completions", baseURL).toString();
  const frames = await readSSE(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
    body: JSON.stringify({
      model: "codex-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Please emit usage." }],
    }),
  });

  expect(frames[frames.length - 1]?.trim()).toBe("[DONE]");
  const objs = parseFrames(frames).filter((o) => o.object === "chat.completion.chunk");
  assertEnvelopeAndStability(objs);

  // find finalizer and usage frames
  const finalizerIdx = objs.findIndex((o) => {
    const ch = o.choices?.[0];
    return (
      ch && ch.delta && Object.keys(ch.delta).length === 0 && typeof ch.finish_reason === "string"
    );
  });
  expect(finalizerIdx).toBeGreaterThanOrEqual(0);

  const usageIdx = objs.findIndex(
    (o) => Array.isArray(o.choices) && o.choices.length === 0 && o.usage
  );
  expect(usageIdx).toBeGreaterThanOrEqual(0);

  // usage has full envelope
  // guard against OOB and avoid bracket access flagged by security rule
  expect(usageIdx).toBeLessThan(objs.length);
  const usage = objs.at(usageIdx);
  expect(typeof usage.id).toBe("string");
  expect(typeof usage.created).toBe("number");
  expect(typeof usage.model).toBe("string");
  expect(usage.usage?.emission_trigger).toBe("token_count");

  // order: finalizer first, then usage, then [DONE]
  expect(finalizerIdx).toBeLessThan(usageIdx);
});
