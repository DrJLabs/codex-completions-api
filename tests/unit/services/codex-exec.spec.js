import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnCodexMock = vi.fn();
const mkdirMock = vi.fn();
const readFileMock = vi.fn();
const unlinkMock = vi.fn();

const fsPromisesMock = {
  mkdir: (...args) => mkdirMock(...args),
  readFile: (...args) => readFileMock(...args),
  unlink: (...args) => unlinkMock(...args),
};

vi.mock("node:fs/promises", () => ({
  default: fsPromisesMock,
  ...fsPromisesMock,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "deadbeef",
}));

vi.mock("../../../src/services/codex-runner.js", () => ({
  spawnCodex: (...args) => spawnCodexMock(...args),
}));

const originalEnv = {
  PROXY_CODEX_WORKDIR: process.env.PROXY_CODEX_WORKDIR,
  PROXY_TITLE_SUMMARY_EXEC_MODEL: process.env.PROXY_TITLE_SUMMARY_EXEC_MODEL,
  PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT: process.env.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT,
  PROXY_TIMEOUT_MS: process.env.PROXY_TIMEOUT_MS,
};

const resetEnv = () => {
  if (originalEnv.PROXY_CODEX_WORKDIR === undefined) {
    delete process.env.PROXY_CODEX_WORKDIR;
  } else {
    process.env.PROXY_CODEX_WORKDIR = originalEnv.PROXY_CODEX_WORKDIR;
  }
  if (originalEnv.PROXY_TITLE_SUMMARY_EXEC_MODEL === undefined) {
    delete process.env.PROXY_TITLE_SUMMARY_EXEC_MODEL;
  } else {
    process.env.PROXY_TITLE_SUMMARY_EXEC_MODEL = originalEnv.PROXY_TITLE_SUMMARY_EXEC_MODEL;
  }
  if (originalEnv.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT === undefined) {
    delete process.env.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT;
  } else {
    process.env.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT =
      originalEnv.PROXY_TITLE_SUMMARY_EXEC_REASONING_EFFORT;
  }
  if (originalEnv.PROXY_TIMEOUT_MS === undefined) {
    delete process.env.PROXY_TIMEOUT_MS;
  } else {
    process.env.PROXY_TIMEOUT_MS = originalEnv.PROXY_TIMEOUT_MS;
  }
};

const createChild = () => {
  const child = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.write = vi.fn(() => true);
  stdin.end = vi.fn();
  stdin.once = stdin.on.bind(stdin);
  child.stdin = stdin;
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const loadExec = async () => {
  vi.resetModules();
  return await import("../../../src/services/codex-exec.js");
};

beforeEach(() => {
  mkdirMock.mockReset();
  readFileMock.mockReset();
  unlinkMock.mockReset();
  spawnCodexMock.mockReset();
  mkdirMock.mockResolvedValue();
  readFileMock.mockResolvedValue("ok");
  unlinkMock.mockResolvedValue();
});

afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

describe("runCodexExec", () => {
  it("rejects when prompt is empty", async () => {
    const { runCodexExec } = await loadExec();
    await expect(runCodexExec({ prompt: "   " })).rejects.toThrow(
      "codex exec requires a non-empty prompt"
    );
    expect(spawnCodexMock).not.toHaveBeenCalled();
  });

  it("spawns codex exec and returns trimmed output", async () => {
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    process.env.PROXY_TITLE_SUMMARY_EXEC_MODEL = "gpt-test";
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const child = createChild();
    spawnCodexMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("  ok  \n");
    unlinkMock.mockResolvedValue();

    const { runCodexExec } = await loadExec();
    const promise = runCodexExec({
      prompt: "hello",
      model: "custom-model",
      reqId: "req-1",
      route: "/v1/chat",
      mode: "chat",
      env: { EXTRA: "1" },
    });

    await flushPromises();
    child.emit("exit", 0, null);
    const output = await promise;

    const expectedDir = path.join("/tmp/codex-work", "exec-output");
    const expectedPath = path.join(expectedDir, "exec-1700000000000-deadbeef.txt");

    expect(mkdirMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(spawnCodexMock).toHaveBeenCalledTimes(1);
    const [args, options] = spawnCodexMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        "exec",
        "--skip-git-repo-check",
        "--output-last-message",
        expectedPath,
        "-m",
        "custom-model",
      ])
    );
    expect(options).toEqual({
      reqId: "req-1",
      route: "/v1/chat",
      mode: "chat",
      env: { EXTRA: "1" },
    });
    expect(child.stdin.write).toHaveBeenCalledWith("hello");
    expect(output).toBe("ok");
    expect(unlinkMock).toHaveBeenCalledWith(expectedPath);
    nowSpy.mockRestore();
  });

  it("adds reasoning effort flags when provided", async () => {
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    const child = createChild();
    spawnCodexMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("ok");
    unlinkMock.mockResolvedValue();
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const { runCodexExec } = await loadExec();
    const promise = runCodexExec({ prompt: "hello", reasoningEffort: " High " });

    await flushPromises();
    child.emit("exit", 0, null);
    await promise;

    const [args] = spawnCodexMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        "-c",
        'model_reasoning_effort="high"',
        "-c",
        'reasoning.effort="high"',
      ])
    );
  });

  it("rejects on non-zero exit and includes stderr", async () => {
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    const child = createChild();
    spawnCodexMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("ok");
    unlinkMock.mockResolvedValue();
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const { runCodexExec } = await loadExec();
    const promise = runCodexExec({ prompt: "hello" });

    await flushPromises();
    child.stderr.emit("data", Buffer.from("bad"));
    child.emit("exit", 1, null);

    await expect(promise).rejects.toThrow(/code 1.*bad/);
    expect(unlinkMock).toHaveBeenCalled();
  });

  it("times out and kills the child", async () => {
    vi.useFakeTimers();
    process.env.PROXY_CODEX_WORKDIR = "/tmp/codex-work";
    const child = createChild();
    spawnCodexMock.mockReturnValue(child);

    const { runCodexExec } = await loadExec();
    const promise = runCodexExec({ prompt: "hello", timeoutMs: 5 });

    await flushPromises();
    const rejection = expect(promise).rejects.toThrow("codex exec timed out");
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});
