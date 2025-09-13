#!/usr/bin/env node
/*
  Proto shim that emits content but exits without task_complete to simulate truncation.
  Sequence: session_configured -> task_started -> agent_message (full) -> (no token_count) -> exit
*/
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
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
  } catch {}

  write({ type: "session_configured" });
  write({ type: "task_started" });
  await delay(5);
  const message = "Hello (truncated) from fake-codex.";
  write({ type: "agent_message", msg: { message } });
  // Do not emit token_count or task_complete; exit shortly after
  await delay(5);
  try {
    process.stdout.end?.();
  } catch {}
};

main().catch(() => process.exit(0));
