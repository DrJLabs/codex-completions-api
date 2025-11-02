#!/usr/bin/env node

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function ensureDirectory(dir) {
  // Output directory is within the project tree; path is fully controlled.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await access(filePath, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeVersion(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[^0-9]*/, "");
}

async function loadCliVersion() {
  const rootPkgPath = path.resolve(PROJECT_ROOT, "package.json");
  const rootRaw = await readFile(rootPkgPath, "utf8");
  const rootPkg = JSON.parse(rootRaw);
  const declared = normalizeVersion(rootPkg?.dependencies?.["@openai/codex"]);

  const pkgPath = path.resolve(PROJECT_ROOT, "node_modules", "@openai", "codex", "package.json");
  let installed = null;
  if (await fileExists(pkgPath)) {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    installed = normalizeVersion(pkg?.version);
  }

  const resolved = declared || installed;
  if (!resolved) {
    throw new Error(
      "Unable to resolve @openai/codex version from dependencies or installed package"
    );
  }

  if (declared && installed && declared !== installed) {
    console.warn(
      `Warning: declared @openai/codex version (${declared}) does not match installed (${installed})`
    );
  }

  return resolved;
}

async function main() {
  const cliVersion = await loadCliVersion();
  const templatePath = path.resolve(__dirname, "schema-template.ts");
  const outputDir = path.resolve(PROJECT_ROOT, "src", "lib", "json-rpc");
  const outputPath = path.resolve(outputDir, "schema.ts");

  const template = await readFile(templatePath, "utf8");
  const replacements = new Map([["{{cliVersion}}", cliVersion]]);

  let rendered = template;
  for (const [token, value] of replacements) {
    rendered = rendered.split(token).join(value);
  }

  if (/{{[\w]+}}/.test(rendered)) {
    throw new Error("Unresolved template placeholders remain in schema output");
  }

  const normalized = `${rendered.trimEnd()}\n`;

  await ensureDirectory(outputDir);

  if (await fileExists(outputPath)) {
    const existing = await readFile(outputPath, "utf8");
    if (existing === normalized) {
      console.log(`schema.ts already up-to-date for @openai/codex@${cliVersion}`);
      return;
    }
  }

  await writeFile(outputPath, normalized, "utf8");
  console.log(`Wrote schema.ts using @openai/codex@${cliVersion}`);
}

main().catch((err) => {
  console.error("Failed to render JSON-RPC schema:", err);
  process.exitCode = 1;
});
