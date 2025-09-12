#!/usr/bin/env node
// Emits a long-running stream; writes PID to CHILD_PID_FILE if provided
/* eslint-disable security/detect-non-literal-fs-filename */
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";

const write = (obj) => {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch {}
};

const main = async () => {
  try {
    if (process.env.CHILD_PID_FILE) {
      fs.writeFileSync(process.env.CHILD_PID_FILE, String(process.pid), "utf8");
    }
  } catch {}

  // Read one submission line
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
  // Emit a few deltas over time and mark readiness after first delta
  for (let i = 0; i < 50; i++) {
    write({ type: "agent_message_delta", msg: { delta: `tick-${i} ` } });
    if (i === 0) {
      try {
        const f = process.env.STREAM_READY_FILE;
        if (f) fs.writeFileSync(f, String(process.pid), "utf8");
      } catch {}
    }
    await delay(100);
  }
  write({ type: "task_complete" });
};

main().catch(() => process.exit(0));
