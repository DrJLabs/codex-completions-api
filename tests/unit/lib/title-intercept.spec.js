import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const createRes = () => ({
  setHeader: vi.fn(),
  json: vi.fn(),
  write: vi.fn(),
  end: vi.fn(),
});

const baseBody = {
  model: "codex-5",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "<conversation_text>Hello world</conversation_text>" },
        { type: "text", text: "Generate a concise title (max 5 words)" },
      ],
    },
  ],
};

const restoreEnv = () => {
  delete process.env.PROXY_TITLE_GEN_INTERCEPT;
};

const loadIntercept = async () => {
  vi.resetModules();
  const mod = await import("../../../src/lib/title-intercept.js");
  return mod.maybeHandleTitleIntercept;
};

beforeEach(() => {
  restoreEnv();
});

afterEach(() => {
  restoreEnv();
});

describe("maybeHandleTitleIntercept", () => {
  test("returns false when intercept disabled", async () => {
    process.env.PROXY_TITLE_GEN_INTERCEPT = "false";
    const maybeHandleTitleIntercept = await loadIntercept();
    const res = createRes();
    const handled = maybeHandleTitleIntercept({ body: baseBody, model: "codex-5", res });
    expect(handled).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
  });

  test("returns false when no title markers present", async () => {
    const maybeHandleTitleIntercept = await loadIntercept();
    const res = createRes();
    const handled = maybeHandleTitleIntercept({
      body: { ...baseBody, messages: [{ role: "user", content: "Just chat" }] },
      model: "codex-5",
      res,
    });
    expect(handled).toBe(false);
  });

  test("non-stream response writes json body", async () => {
    const maybeHandleTitleIntercept = await loadIntercept();
    const res = createRes();
    const handled = maybeHandleTitleIntercept({
      body: baseBody,
      model: "codex-5",
      res,
      stream: false,
    });
    expect(handled).toBe(true);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.choices?.[0]?.message?.content).toBe("Hello world");
    expect(body.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  test("stream response writes SSE chunks and ends", async () => {
    const maybeHandleTitleIntercept = await loadIntercept();
    const res = createRes();
    const handled = maybeHandleTitleIntercept({
      body: baseBody,
      model: "codex-5",
      res,
      stream: true,
    });
    expect(handled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.write).toHaveBeenCalledTimes(4);
    const writes = res.write.mock.calls.map(([arg]) => String(arg));
    expect(writes[writes.length - 1]).toContain("[DONE]");
    expect(res.end).toHaveBeenCalled();
  });
});
