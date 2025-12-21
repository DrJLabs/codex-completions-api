import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_ROOT = path.join(process.cwd(), "tests", "fixtures", "obsidian-copilot", "responses");

export async function loadCopilotResponsesFixture(filename) {
  const fullPath = path.join(FIXTURE_ROOT, filename);
  const raw = await readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

export { FIXTURE_ROOT as COPILOT_RESPONSES_FIXTURE_ROOT };
