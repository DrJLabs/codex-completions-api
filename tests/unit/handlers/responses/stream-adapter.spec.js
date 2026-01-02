import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSSE } from "../../../shared/transcript-utils.js";
import { createToolCallAggregator } from "../../../../src/lib/tool-call-aggregator.js";
import { createResponsesStreamCapture } from "../../../../src/handlers/responses/capture.js";

vi.mock("../../../../src/services/metrics/index.js", () => ({
  recordResponsesSseEvent: vi.fn(),
}));

vi.mock("../../../../src/lib/tool-call-aggregator.js", () => ({
  createToolCallAggregator: vi.fn(),
}));

vi.mock("../../../../src/handlers/responses/capture.js", () => ({
  createResponsesStreamCapture: vi.fn(),
}));

vi.mock("../../../../src/services/logging/schema.js", () => ({
  logStructured: vi.fn(),
  sha256: vi.fn(() => "hash"),
  shouldLogVerbose: vi.fn(() => false),
  preview: vi.fn(() => ({ preview: "", truncated: false })),
}));

vi.mock("../../../../src/dev-logging.js", () => ({
  appendProtoEvent: vi.fn(),
  LOG_PROTO: false,
}));

const buildRes = () => ({
  locals: {},
  chunks: [],
  writableEnded: false,
  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  },
  flush: vi.fn(),
  end() {
    this.writableEnded = true;
  },
});

const buildAggregator = (overrides = {}) => ({
  ingestDelta: vi.fn(() => ({ updated: false, deltas: [] })),
  ingestMessage: vi.fn(() => ({ updated: false, deltas: [] })),
  snapshot: vi.fn(() => []),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  createToolCallAggregator.mockReturnValue(buildAggregator());
  createResponsesStreamCapture.mockReturnValue({
    record: vi.fn(),
    finalize: vi.fn(),
  });
});

describe("responses stream adapter", () => {
  it("emits response.created and output deltas", async () => {
    const { createResponsesStreamAdapter } = await import(
      "../../../../src/handlers/responses/stream-adapter.js"
    );

    const res = buildRes();
    const adapter = createResponsesStreamAdapter(res, { model: "gpt-test" });

    adapter.onChunk({
      id: "chatcmpl-1",
      model: "gpt-test",
      choices: [{ index: 0, delta: { content: "Hello" } }],
    });
    await adapter.onDone();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const entries = parseSSE(res.chunks.join(""));
    expect(entries[0]?.event).toBe("response.created");
    const deltas = entries.filter((entry) => entry.event === "response.output_text.delta");
    expect(deltas.map((entry) => entry.data.delta).join("")).toBe("Hello");
  });
});
