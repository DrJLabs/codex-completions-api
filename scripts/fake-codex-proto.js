#!/usr/bin/env node
/*
  Minimal Codex "proto" shim for tests.
  Emits JSONL events the proxy expects, supporting both streaming and non-streaming flows.

  Behavior:
  - Reads one JSON line from stdin representing a user_input submission
  - Emits a small sequence of protocol events:
    session_configured -> task_started -> agent_message_delta/agent_message -> token_count -> task_complete
*/

import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
};

const main = async () => {
  let submission = "";
  try {
    // Read first line from stdin
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      submission += chunk;
      const idx = submission.indexOf("\n");
      if (idx >= 0) {
        submission = submission.slice(0, idx);
        break;
      }
    }
  } catch {}

  // Emit a deterministic short response
  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(10);
  write({ type: "agent_reasoning_delta", msg: { delta: "…" } });
  await delay(10);
  // Send both delta and full message to satisfy either incremental or final-only logic
  const message = "Hello from fake-codex.";
  write({ type: "agent_message_delta", msg: { delta: message.slice(0, 7) } });
  await delay(5);
  write({ type: "agent_message", msg: { message } });
  await delay(5);
  const requestedFinish = String(process.env.FAKE_CODEX_FINISH_REASON || "stop")
    .trim()
    .toLowerCase();
  const finishReason = ["length", "max_tokens", "token_limit"].includes(requestedFinish)
    ? "length"
    : "stop";
  const tokenCountMsg = {
    prompt_tokens: 8,
    completion_tokens: Math.ceil(message.length / 4),
  };
  if (finishReason === "length") {
    tokenCountMsg.finish_reason = "length";
    tokenCountMsg.reason = "length";
    tokenCountMsg.token_limit_reached = true;
  }
  write({
    type: "token_count",
    msg: tokenCountMsg,
  });
  await delay(5);
  const taskCompletePayload = { type: "task_complete" };
  if (finishReason) {
    taskCompletePayload.msg = { finish_reason: finishReason };
  }
  write(taskCompletePayload);
  try {
    process.stdout.end?.();
  } catch {}
};

main().catch(() => process.exit(0));
