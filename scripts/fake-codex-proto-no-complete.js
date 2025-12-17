#!/usr/bin/env node
/*
  Proto shim that emits content but exits without task_complete to simulate truncation.
  Sequence: session_configured -> task_started -> agent_message (full) -> (no token_count) -> exit
*/
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    console.error("[fake-codex-proto-no-complete] write error:", e);
  }
};

const main = async () => {
  try {
    process.stdin.setEncoding("utf8");
    // Read a single line submission
    let buf = "";
    for await (const chunk of process.stdin) {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) break;
    }
  } catch (e) {
    console.error("[fake-codex-proto-no-complete] stdin read error:", e);
  }

  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(5);
  const message = "Hello (truncated) from fake-codex.";
  write({ type: "agent_message", msg: { message } });
  const finishReason = String(process.env.FAKE_CODEX_FINISH_REASON || "stop")
    .trim()
    .toLowerCase();
  const tokenCount = {
    prompt_tokens: 5,
    completion_tokens: 9,
    total_tokens: 14,
  };
  if (finishReason === "length") {
    tokenCount.finish_reason = "length";
    tokenCount.token_limit_reached = true;
    tokenCount.reason = "length";
  } else {
    tokenCount.finish_reason = finishReason || "stop";
  }
  // Emit token_count (still omitting task_complete) to simulate early exit.
  write({
    type: "token_count",
    msg: tokenCount,
  });
  // Do not emit task_complete; exit shortly after
  await delay(5);
  try {
    process.stdout.end?.();
  } catch (e) {
    console.error("[fake-codex-proto-no-complete] stdout end error:", e);
  }
};

main().catch((err) => {
  console.error("fake-codex-proto-no-complete script failed:", err);
  process.exit(1);
});
