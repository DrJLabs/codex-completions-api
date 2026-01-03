import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const mkdirSyncMock = vi.fn();
const logBackendLifecycleMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args) => spawnMock(...args),
}));

const fsMock = {
  mkdirSync: (...args) => mkdirSyncMock(...args),
};

vi.mock("node:fs", () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock("../../../src/dev-trace/backend.js", () => ({
  logBackendLifecycle: (...args) => logBackendLifecycleMock(...args),
}));

const originalEnv = {
  CODEX_BIN: process.env.CODEX_BIN,
  CODEX_HOME: process.env.CODEX_HOME,
  PROXY_CODEX_WORKDIR: process.env.PROXY_CODEX_WORKDIR,
  PROXY_API_KEY: process.env.PROXY_API_KEY,
  PROXY_METRICS_TOKEN: process.env.PROXY_METRICS_TOKEN,
};

const resetEnv = () => {
  if (originalEnv.CODEX_BIN === undefined) {
    delete process.env.CODEX_BIN;
  } else {
    process.env.CODEX_BIN = originalEnv.CODEX_BIN;
  }
  if (originalEnv.CODEX_HOME === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalEnv.CODEX_HOME;
  }
  if (originalEnv.PROXY_CODEX_WORKDIR === undefined) {
    delete process.env.PROXY_CODEX_WORKDIR;
  } else {
    process.env.PROXY_CODEX_WORKDIR = originalEnv.PROXY_CODEX_WORKDIR;
  }
  if (originalEnv.PROXY_API_KEY === undefined) {
    delete process.env.PROXY_API_KEY;
  } else {
    process.env.PROXY_API_KEY = originalEnv.PROXY_API_KEY;
  }
  if (originalEnv.PROXY_METRICS_TOKEN === undefined) {
    delete process.env.PROXY_METRICS_TOKEN;
  } else {
    process.env.PROXY_METRICS_TOKEN = originalEnv.PROXY_METRICS_TOKEN;
  }
};

const createChild = () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = vi.fn();
  child.stderr.setEncoding = vi.fn();
  return child;
};

const loadRunner = async () => {
  vi.resetModules();
  return await import("../../../src/services/codex-runner.js");
};

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe("spawnCodex", () => {
  it("spawns with sanitized env, logs lifecycle, and sets encodings", async () => {
    process.env.CODEX_BIN = "codex";
    process.env.CODEX_HOME = "/tmp/codex-home";
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    process.env.PROXY_API_KEY = "secret";
    process.env.PROXY_METRICS_TOKEN = "metrics";

    const child = createChild();
    spawnMock.mockReturnValue(child);

    const { spawnCodex } = await loadRunner();
    const spawned = spawnCodex(["arg1"], {
      env: { EXTRA: "1", PROXY_API_KEY: "leak" },
      cwd: "/tmp/custom",
      reqId: "req-1",
      route: "/v1/chat",
      mode: "chat",
    });

    expect(spawned).toBe(child);
    expect(mkdirSyncMock).toHaveBeenCalledWith("/tmp/custom", { recursive: true });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawnMock.mock.calls[0];
    expect(bin).toBe("codex");
    expect(args).toEqual(["arg1"]);
    expect(options.cwd).toBe("/tmp/custom");
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(options.shell).toBe(false);
    expect(options.detached).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(options.env.CODEX_HOME).toBe("/tmp/codex-home");
    expect(options.env.EXTRA).toBe("1");
    expect(options.env.PROXY_API_KEY).toBeUndefined();
    expect(options.env.PROXY_METRICS_TOKEN).toBeUndefined();

    child.emit("exit", 0, null);
    expect(logBackendLifecycleMock).toHaveBeenCalledWith(
      "backend_start",
      expect.objectContaining({
        req_id: "req-1",
        route: "/v1/chat",
        mode: "chat",
        pid: 4242,
      })
    );
    expect(logBackendLifecycleMock).toHaveBeenCalledWith(
      "backend_exit",
      expect.objectContaining({
        req_id: "req-1",
        route: "/v1/chat",
        mode: "chat",
        pid: 4242,
        code: 0,
        signal: null,
      })
    );
    expect(child.stdout.setEncoding).toHaveBeenCalledWith("utf8");
    expect(child.stderr.setEncoding).toHaveBeenCalledWith("utf8");
  });

  it("resolves relative CODEX_BIN paths", async () => {
    process.env.CODEX_BIN = "bin/codex";
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    const child = createChild();
    spawnMock.mockReturnValue(child);

    const { resolvedCodexBin, spawnCodex } = await loadRunner();
    const expected = path.join(process.cwd(), "bin/codex");
    expect(resolvedCodexBin).toBe(expected);

    spawnCodex([]);
    expect(spawnMock).toHaveBeenCalledWith(expected, [], expect.any(Object));
  });

  it("swallows mkdir errors before spawning", async () => {
    process.env.CODEX_BIN = "codex";
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    const child = createChild();
    spawnMock.mockReturnValue(child);
    mkdirSyncMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { spawnCodex } = await loadRunner();
    expect(() => spawnCodex(["arg1"])).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });
});
