#!/usr/bin/env node
/*
  Proto shim that emits a usage event even when clients do not request include_usage.
  Sequence: session_configured -> task_started -> agent_message -> usage -> task_complete
*/
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    console.error("[fake-codex-proto-provider-usage] write error:", e);
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
    console.error("[fake-codex-proto-provider-usage] stdin error:", e);
  }
};

const main = async () => {
  await readSubmission();
  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(5);
  const message = "Provider supplied usage chunk.";
  write({ type: "agent_message", msg: { message } });
  await delay(5);
  write({ type: "usage", msg: { prompt_tokens: 9, completion_tokens: 5 } });
  await delay(5);
  write({ type: "task_complete" });
  try {
    process.stdout.end?.();
  } catch (e) {
    console.error("[fake-codex-proto-provider-usage] stdout end error:", e);
  }
};

main().catch((err) => {
  console.error("fake-codex-proto-provider-usage script failed:", err);
  process.exit(1);
});
