#!/usr/bin/env node
// Hangs after reading one submission line (no output), to trigger proto idle timeout
import { setTimeout as delay } from "node:timers/promises";

const main = async () => {
  try {
    process.stdin.setEncoding("utf8");
    // Read one line (submission)
    let buf = "";
    for await (const chunk of process.stdin) {
      buf += chunk;
      const idx = buf.indexOf("\n");
      if (idx >= 0) break;
    }
  } catch {}
  // Keep process alive long enough for proxy to hit idle
  await delay(10_000);
};

main().catch(() => process.exit(0));
