import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const readTelemetryFile = async (file) => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlled test temp path
    const data = await fs.readFile(file, "utf8");
    return data
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
};

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe("dev-logging sanitizer telemetry", () => {
  let telemetryPath;

  beforeEach(() => {
    vi.resetModules();
    telemetryPath = path.join(os.tmpdir(), `san-telemetry-${randomUUID()}.ndjson`);
    process.env.SANITIZER_LOG_PATH = telemetryPath;
    process.env.SANITIZER_LOG_BASE_DIR = os.tmpdir();
  });

  afterEach(async () => {
    delete process.env.SANITIZER_LOG_PATH;
    delete process.env.SANITIZER_LOG_BASE_DIR;
    await fs.rm(telemetryPath, { force: true });
  });

  test("logs toggle transitions only when state changes", async () => {
    const mod = await import("../../src/dev-logging.js");
    mod.__resetSanitizerTelemetryStateForTests();

    mod.logSanitizerToggle({ enabled: true, trigger: "unit", mode: "test", reqId: "req-1" });
    // Duplicate should be ignored
    mod.logSanitizerToggle({ enabled: true, trigger: "unit", mode: "test", reqId: "req-1" });
    mod.logSanitizerToggle({ enabled: false, trigger: "unit", mode: "test", reqId: "req-1" });

    await flushAsync();
    const entries = await readTelemetryFile(telemetryPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("proxy_sanitize_metadata");
    expect(entries[0].enabled).toBe(true);
    expect(entries[1].enabled).toBe(false);
    expect(entries[1].kind).toBe("proxy_sanitize_metadata");
  });

  test("logs sanitizer summary snapshots", async () => {
    const mod = await import("../../src/dev-logging.js");
    mod.__resetSanitizerTelemetryStateForTests();

    mod.logSanitizerSummary({
      enabled: true,
      route: "/v1/chat/completions",
      mode: "chat_nonstream",
      reqId: "req-telemetry",
      count: 3,
      keys: ["rollout_path", "session_id", "rollout_path"],
      sources: ["message.metadata", "delta.metadata"],
    });

    await flushAsync();
    const entries = await readTelemetryFile(telemetryPath);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.kind).toBe("metadata_sanitizer_summary");
    expect(entry.sanitized_count).toBe(3);
    expect(entry.sanitized_keys).toEqual(["rollout_path", "session_id"]);
    expect(entry.sanitized_sources).toEqual(["message.metadata", "delta.metadata"]);
    expect(entry.enabled).toBe(true);
  });

  test("falls back to default path when env value escapes tmp dir", async () => {
    const fallback = path.join(path.resolve(os.tmpdir()), "codex-sanitizer.ndjson");
    const unsafe = path.join(path.parse(path.resolve(os.tmpdir())).root, "etc", "passwd");
    process.env.SANITIZER_LOG_PATH = unsafe;
    telemetryPath = fallback;

    const mod = await import("../../src/dev-logging.js");
    expect(mod.SANITIZER_LOG_PATH).toBe(fallback);
  });

  test("allows sanitizer log override within configured base directory", async () => {
    const baseDir = path.join(os.tmpdir(), `san-base-${randomUUID()}`);
    const relativePath = path.join("nested", "custom.ndjson");

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- controlled test directory
    await fs.mkdir(baseDir, { recursive: true });
    process.env.SANITIZER_LOG_BASE_DIR = baseDir;
    process.env.SANITIZER_LOG_PATH = relativePath;
    telemetryPath = path.join(baseDir, relativePath);

    const mod = await import("../../src/dev-logging.js");
    expect(mod.SANITIZER_LOG_PATH).toBe(telemetryPath);

    await fs.rm(baseDir, { recursive: true, force: true });
  });
});
