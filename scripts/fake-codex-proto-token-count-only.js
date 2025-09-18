#!/usr/bin/env node
/*
  Proto shim that emits token_count but exits before task_complete to simulate
  truncation where the proxy must finalize using token_count data.
*/
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    console.error("[fake-codex-proto-token-count-only] write error:", e);
  }
};

const readSubmission = async () => {
  try {
    process.stdin.setEncoding("utf8");
    let buf = "";
    for await (const chunk of process.stdin) {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) break;
    }
  } catch (e) {
    console.error("[fake-codex-proto-token-count-only] stdin error:", e);
  }
};

const main = async () => {
  await readSubmission();
  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(5);
  const message = "Token-count only stream response.";
  write({ type: "agent_message", msg: { message } });
  await delay(5);
  write({ type: "token_count", msg: { prompt_tokens: 11, completion_tokens: 7 } });
  await delay(5);
  try {
    process.stdout.end?.();
  } catch (e) {
    console.error("[fake-codex-proto-token-count-only] stdout end error:", e);
  }
};

main().catch((err) => {
  console.error("fake-codex-proto-token-count-only script failed:", err);
  process.exit(1);
});
