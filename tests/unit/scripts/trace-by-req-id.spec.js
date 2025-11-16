import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const runScript = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/dev/trace-by-req-id.js", ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `exit ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });

describe("trace-by-req-id CLI", () => {
  let tempDir;
  let accessLog;
  let protoLog;
  let usageLog;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "trace-cli-"));
    accessLog = path.join(tempDir, "access.ndjson");
    protoLog = path.join(tempDir, "proto.ndjson");
    usageLog = path.join(tempDir, "usage.ndjson");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stitches access, proto, and usage entries for a req_id", async () => {
    const reqId = "req-cli-1";
    const accessEntry = JSON.stringify({ ts: 10, req_id: reqId, method: "POST" });
    const protoEntry = JSON.stringify({
      ts: 20,
      req_id: reqId,
      phase: "client_egress",
      kind: "client_sse",
    });
    const usageEntry = JSON.stringify({ ts: 30, req_id: reqId, phase: "usage_summary" });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp test logs
    await writeFile(accessLog, `${accessEntry}\n`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp test logs
    await writeFile(protoLog, `${protoEntry}\n`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp test logs
    await writeFile(usageLog, `${usageEntry}\n`);

    const output = await runScript([
      "--req-id",
      reqId,
      "--access-log",
      accessLog,
      "--proto-log",
      protoLog,
      "--usage-log",
      usageLog,
    ]);

    expect(output).toContain(`Trace timeline for req_id=${reqId}`);
    const lines = output.split(/\n+/).filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("[access]");
    expect(lines[2]).toContain("[proto]");
    expect(lines[3]).toContain("[usage]");
  });
});
