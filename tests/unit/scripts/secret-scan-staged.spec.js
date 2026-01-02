import { describe, expect, test, vi } from "vitest";
import { listStagedFiles, main } from "../../../scripts/secret-scan-staged.mjs";

describe("secret-scan-staged", () => {
  test("listStagedFiles parses null-delimited output", () => {
    const exec = vi.fn(() => ({
      status: 0,
      stdout: "a.txt\0b.txt\0",
      stderr: "",
    }));

    expect(listStagedFiles({ exec })).toEqual(["a.txt", "b.txt"]);
  });

  test("main skips secretlint when no staged files exist", () => {
    const exec = vi.fn((cmd) => {
      if (cmd === "git") {
        return { status: 0, stdout: "a.txt\0", stderr: "" };
      }
      if (cmd === "npx") {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const exists = vi.fn(() => false);

    const exitCode = main({ exec, exists });

    expect(exitCode).toBe(0);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("main returns secretlint exit code for staged files", () => {
    const exec = vi.fn((cmd) => {
      if (cmd === "git") {
        return { status: 0, stdout: "a.txt\0", stderr: "" };
      }
      if (cmd === "npx") {
        return { status: 2, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    });
    const exists = vi.fn(() => true);

    const exitCode = main({ exec, exists });

    expect(exitCode).toBe(2);
  });
});
