import { parseStreamEventLine } from "./stream-event.js";

export const wireStreamTransport = ({ child, runtime }) => {
  child.stdout.on("data", (chunk) => {
    const parsed = parseStreamEventLine(String(chunk));
    if (!parsed) return;
    if (parsed.type === "agent_message_delta") {
      runtime.handleDelta({
        choiceIndex: parsed.baseChoiceIndex ?? 0,
        delta: parsed.messagePayload,
      });
    }
  });
};
