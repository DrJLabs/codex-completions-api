import { describe, test, expect, vi, beforeEach } from "vitest";
import { maybeHandleTitleSummaryIntercept } from "../../../../src/handlers/responses/title-summary-intercept.js";
import { runCodexExec } from "../../../../src/services/codex-exec.js";
import {
  logResponsesIngressRaw,
  summarizeResponsesIngress,
} from "../../../../src/handlers/responses/ingress-logging.js";
import { captureResponsesNonStream } from "../../../../src/handlers/responses/capture.js";

vi.mock("../../../../src/services/codex-exec.js", () => ({
  runCodexExec: vi.fn(),
}));
vi.mock("../../../../src/handlers/responses/ingress-logging.js", () => ({
  logResponsesIngressRaw: vi.fn(),
  summarizeResponsesIngress: vi.fn(),
}));
vi.mock("../../../../src/handlers/responses/capture.js", () => ({
  captureResponsesNonStream: vi.fn(),
}));

const createRes = () => {
  const res = {
    locals: {},
    headers: {},
    statusCode: null,
    payload: null,
    setHeader(key, value) {
      // eslint-disable-next-line security/detect-object-injection -- test helper for headers
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  summarizeResponsesIngress.mockReturnValue({
    has_input: true,
    input_is_array: true,
    input_item_types: ["message"],
    input_message_count: 1,
    input_message_roles: ["user"],
    has_metadata: false,
    has_tools: false,
    has_tool_choice: false,
  });
  runCodexExec.mockResolvedValue('{"title":"Hello","summary":"World"}');
});

describe("responses title/summary intercept", () => {
  test("intercepts title+summary prompt and returns responses envelope", async () => {
    const req = { headers: {} };
    const res = createRes();
    const body = {
      input: [
        {
          type: "message",
          role: "developer",
          content:
            'Your task is to analyze a conversation and generate both a title and a summary.\n\n# OUTPUT FORMAT\nYou must return your response in the following JSON format:\n{\n  "title": "Brief 2-8 word title capturing the main user intent",\n  "summary": "2-3 sentence summary at most including key details (e.g. user facts mentioned entities), and key conclusions if there are any."\n}\n\n# RULES\n* Use the same language as the conversation',
        },
        {
          type: "message",
          role: "user",
          content: "Conversation:\nuser: hello\nai: hi",
        },
      ],
    };

    const handled = await maybeHandleTitleSummaryIntercept({
      req,
      res,
      body,
      stream: false,
    });

    expect(handled).toBe(true);
    expect(logResponsesIngressRaw).toHaveBeenCalled();
    expect(captureResponsesNonStream).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("completed");
    expect(res.payload.model).toBe("gpt-5.2");
    expect(res.payload.output[0].content[0].text).toContain('"title"');
  });

  test("intercepts title-only prompt and returns responses envelope", async () => {
    const req = { headers: {} };
    const res = createRes();
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content:
            "Generate a concise title (max 5 words) for this conversation based on its content. Return only the title without any explanation or quotes.\n\nConversation:\nuser: hello\nai: hi",
        },
      ],
    };

    runCodexExec.mockResolvedValue("Hello conversation");

    const handled = await maybeHandleTitleSummaryIntercept({
      req,
      res,
      body,
      stream: false,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.payload.output[0].content[0].text).toBe("Hello conversation");
  });

  test("returns 502 when codex exec fails", async () => {
    const req = { headers: {} };
    const res = createRes();
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content:
            "Generate a concise title (max 5 words) for this conversation based on its content. Return only the title without any explanation or quotes.\n\nConversation:\nuser: hello\nai: hi",
        },
      ],
    };

    runCodexExec.mockRejectedValue(new Error("codex exec timed out"));

    const handled = await maybeHandleTitleSummaryIntercept({
      req,
      res,
      body,
      stream: false,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(502);
    expect(res.payload?.error).toBeDefined();
  });
});
