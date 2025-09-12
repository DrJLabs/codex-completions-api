#!/usr/bin/env node
// Emits a couple of proto events then stops emitting to trigger stream idle timeout in proxy
import { setTimeout as delay } from "node:timers/promises";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
};

const main = async () => {
  // Read the first submission line
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
  await delay(10);
  write({ type: "agent_message_delta", msg: { delta: "Hello (pre-hang)" } });
  // hang without completing
  await delay(10_000);
};

main().catch(() => process.exit(0));
