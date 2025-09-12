#!/usr/bin/env node
// Emits a message containing a <use_tool> block followed by extra text
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
};

const TOOL_BLOCK =
  "<use_tool>" +
  "<name>web.search</name>" +
  "<path>/</path>" +
  "<query>hello world</query>" +
  "</use_tool>";

const main = async () => {
  // Read first submission line
  try {
    process.stdin.setEncoding("utf8");
    let buf = "";
    for await (const chunk of process.stdin) {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) break;
    }
  } catch {}

  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(5);
  const msg = `Before ${TOOL_BLOCK} AFTER_TOOL_TEXT`;
  // Emit as a single delta so proxy sees a completed block
  write({ type: "agent_message_delta", msg: { delta: msg } });
  await delay(5);
  write({
    type: "token_count",
    msg: { prompt_tokens: 5, completion_tokens: Math.ceil(msg.length / 4) },
  });
  await delay(5);
  write({ type: "task_complete" });
};

main().catch(() => process.exit(0));
