import { describe, expect, it } from "vitest";
import { parseStreamEventLine } from "../../../../src/handlers/chat/stream-event.js";

const resolveChoiceIndexFromPayload = () => 2;
const extractMetadataFromPayload = () => ({ metadata: { project: "alpha" }, sources: ["prompt"] });

describe("stream event parsing", () => {
  it("parses event type and payload metadata", () => {
    const line = JSON.stringify({
      msg: {
        type: "codex/event/agent_message_delta",
        msg: { delta: { content: "hello" } },
      },
    });

    const parsed = parseStreamEventLine(line, {
      resolveChoiceIndexFromPayload,
      extractMetadataFromPayload,
      sanitizeMetadata: true,
    });

    expect(parsed.type).toBe("agent_message_delta");
    expect(parsed.messagePayload.delta.content).toBe("hello");
    expect(parsed.baseChoiceIndex).toBe(2);
    expect(parsed.metadataInfo.metadata.project).toBe("alpha");
  });
});
