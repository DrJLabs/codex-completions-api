import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const DOC_PATH = new URL(
  "../../docs/app-server-migration/codex-completions-api-migration.md",
  import.meta.url
);
const ENV_EXAMPLE_PATH = new URL("../../.env.example", import.meta.url);
const ENV_DEV_EXAMPLE_PATH = new URL("../../.env.dev.example", import.meta.url);

describe("documentation alignment for PROXY_USE_APP_SERVER", () => {
  it("keeps docs table and sample env defaults in sync", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const doc = readFileSync(DOC_PATH, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const envExample = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const envDevExample = readFileSync(ENV_DEV_EXAMPLE_PATH, "utf8");

    expect(doc).toContain("| Local / Dev stack   | proto (`false`) |");
    expect(doc).toContain("| Staging             | proto (`false`) |");
    expect(doc).toContain("| Production          | proto (`false`) |");

    expect(envExample.split(/\r?\n/)).toContain("PROXY_USE_APP_SERVER=false");
    expect(envDevExample.split(/\r?\n/)).toContain("PROXY_USE_APP_SERVER=false");
  });
});
