#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseSSE } from "../../tests/shared/transcript-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const ARTIFACT_DIR = resolve(
  PROJECT_ROOT,
  "docs",
  "bmad",
  "qa",
  "artifacts",
  "streaming-tool-call"
);

const args = new Set(process.argv.slice(2));
const includeUsage = args.has("--include-usage") || args.has("--includeUsage") || args.has("-u");
const disconnectAfterFirstTool =
  args.has("--disconnect-after-first-tool") || args.has("--disconnect-after-first-delta");
const allowSingle = args.has("--allow-single") || disconnectAfterFirstTool;
const expectXml = args.has("--expect-xml");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:11435";
const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
const endpoint = `${trimmedBase}/v1/chat/completions?stream=true`;
const apiKey = process.env.KEY || process.env.PROXY_API_KEY;

if (!apiKey) {
  console.error("Missing KEY or PROXY_API_KEY environment variable.");
  process.exit(1);
}

const requestBody = {
  model: process.env.MODEL || "codex-5",
  stream: true,
  messages: [{ role: "user", content: "Stream tool execution" }],
  tools: [
    {
      type: "function",
      function: {
        name: "lookup_user",
        description: "Returns fake profile information",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "lookup_user" } },
};

if (includeUsage) {
  requestBody.stream_options = { include_usage: true };
}

const controller = new AbortController();
const timeoutMs = Number(process.env.TIMEOUT_MS || 30_000);
const timeout = setTimeout(() => controller.abort(), timeoutMs);

let rawSSE = "";
const decoder = new TextDecoder();
let abortReason = "";
let abortedEarly = false;

try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Request failed (${res.status}): ${errText}`);
    process.exit(1);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    console.error("Streaming response body missing reader interface.");
    process.exit(1);
  }

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err?.name === "AbortError" && abortReason) {
        abortedEarly = true;
        break;
      }
      throw err;
    }
    const { value, done } = chunk;
    if (done) break;
    if (value) rawSSE += decoder.decode(value, { stream: true });

    if (disconnectAfterFirstTool) {
      const entries = parseSSE(rawSSE);
      const hasToolDelta = entries.some(
        (entry) =>
          entry?.type === "data" &&
          entry.data?.choices?.some(
            (choice) =>
              Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0
          )
      );
      if (hasToolDelta) {
        abortReason = "disconnect-after-first-tool";
        controller.abort();
      }
    }
  }
  rawSSE += decoder.decode();
} catch (error) {
  if (error?.name === "AbortError" && abortReason) {
    // Expected when simulating client disconnect.
  } else if (error?.name === "AbortError") {
    console.error(`Request timed out after ${timeoutMs}ms.`);
    process.exit(1);
  } else {
    console.error("Smoke request failed:", error);
    process.exit(1);
  }
} finally {
  clearTimeout(timeout);
}

const entries = parseSSE(rawSSE);
const uniqueToolIds = new Set();
for (const entry of entries) {
  if (entry?.type !== "data") continue;
  const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
  for (const choice of choices) {
    const deltas = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
    deltas.forEach((call) => {
      if (call?.id) uniqueToolIds.add(call.id);
    });
  }
}
if (!allowSingle) {
  if (uniqueToolIds.size < 2) {
    console.error(
      `Expected at least 2 unique tool calls in stream but found ${uniqueToolIds.size}. ` +
        "Use --allow-single to skip this check."
    );
    process.exit(1);
  }
}

const dataEntries = entries.filter((entry) => entry?.type === "data");

// Mixed-frame guard: no frame should contain content and tool_calls together.
const mixedFrame = dataEntries.find((entry) =>
  entry.data?.choices?.some(
    (choice) =>
      typeof choice?.delta?.content === "string" &&
      Array.isArray(choice?.delta?.tool_calls) &&
      choice.delta.tool_calls.length > 0
  )
);
if (mixedFrame) {
  console.error("Detected mixed content and tool_calls in the same frame.");
  process.exit(1);
}

// Finish reason: require tool_calls
const finishReasons = [];
dataEntries.forEach((entry) =>
  (entry.data?.choices || []).forEach((choice) => {
    if (choice?.finish_reason) finishReasons.push(choice.finish_reason);
  })
);
if (!disconnectAfterFirstTool && !finishReasons.includes("tool_calls")) {
  console.error("Missing finish_reason: tool_calls in stream.");
  process.exit(1);
}

// Role-first exactly once per choice
const roleFirstIndex = dataEntries.findIndex((entry) =>
  entry.data?.choices?.some((choice) => choice?.delta?.role === "assistant")
);
const hasRoleFirst = roleFirstIndex !== -1;
if (roleFirstIndex === -1) {
  console.error("No assistant role chunk found.");
  process.exit(1);
}
const toolDeltaIndex = dataEntries.findIndex((entry) =>
  entry.data?.choices?.some(
    (choice) => Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0
  )
);
if (toolDeltaIndex !== -1 && toolDeltaIndex < roleFirstIndex) {
  console.error("Tool delta arrived before assistant role chunk.");
  process.exit(1);
}

if (!disconnectAfterFirstTool) {
  // Finish ordering: exactly one finish chunk per choice, and no deltas after finish.
  const finishIndexByChoice = new Map();
  dataEntries.forEach((entry, idx) => {
    entry.data?.choices?.forEach((choice) => {
      if (choice?.finish_reason) finishIndexByChoice.set(choice.index ?? 0, idx);
    });
  });
  for (const entry of dataEntries) {
    entry.data?.choices?.forEach((choice) => {
      const finishIdx = finishIndexByChoice.get(choice.index ?? 0);
      if (finishIdx === undefined) return;
      if (
        dataEntries.indexOf(entry) > finishIdx &&
        (typeof choice?.delta?.content === "string" ||
          (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0))
      ) {
        console.error("Found deltas after finish chunk for choice", choice.index ?? 0);
        process.exit(1);
      }
    });
  }
}

if (expectXml) {
  const xmlChunkEntry = dataEntries
    .map((entry) =>
      entry.data?.choices
        ?.map((choice) => choice?.delta?.content)
        .find((content) => typeof content === "string" && content.includes("<use_tool>"))
    )
    .find((content) => typeof content === "string");
  if (!xmlChunkEntry) {
    console.error("Expected XML <use_tool> content but none was found.");
    process.exit(1);
  }
  const trimmed = xmlChunkEntry.trim();
  if (!trimmed.endsWith("</use_tool>")) {
    console.error("XML <use_tool> block is not properly terminated.");
    process.exit(1);
  }
  const xmlIndex = dataEntries.findIndex((entry) =>
    entry.data?.choices?.some(
      (choice) =>
        typeof choice?.delta?.content === "string" && choice.delta.content.includes("<use_tool>")
    )
  );
  const trailingContent = dataEntries
    .slice(xmlIndex + 1)
    .some((entry) =>
      entry.data?.choices?.some(
        (choice) => typeof choice?.delta?.content === "string" && choice.delta.content.length > 0
      )
    );
  if (trailingContent) {
    console.error(
      "Found trailing assistant content after <use_tool> block; tail should be stripped."
    );
    process.exit(1);
  }
}

const doneFrames = entries.filter((entry) => entry?.type === "done");

if (disconnectAfterFirstTool) {
  const finishFrames = dataEntries.filter((entry) =>
    entry.data?.choices?.some((choice) => choice.finish_reason)
  );
  if (finishFrames.length > 0) {
    console.error("Expected no finish frames after client disconnect.");
    process.exit(1);
  }
  if (doneFrames.length > 0) {
    console.error("Expected no [DONE] after client disconnect.");
    process.exit(1);
  }
}

const secretPattern = /(sk-[a-zA-Z0-9]{10,}|Authorization)/;
if (secretPattern.test(rawSSE)) {
  console.error("Detected potential secret in SSE stream; aborting.");
  process.exit(1);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseName = `streaming-tool-call-${timestamp}`;
const logPath = resolve(ARTIFACT_DIR, `${baseName}.sse`);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constructed from project-root constants and sanitized timestamp
await writeFile(logPath, rawSSE, "utf8");

const hash = createHash("sha256").update(rawSSE, "utf8").digest("hex");
const hashPath = resolve(ARTIFACT_DIR, `${baseName}.sha256`);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constructed from project-root constants and sanitized timestamp
await writeFile(hashPath, `${hash}  ${baseName}.sse\n`, "utf8");

const manifestPath = resolve(
  PROJECT_ROOT,
  "tests",
  "e2e",
  "fixtures",
  "tool-calls",
  "manifest.json"
);
const verdict = {
  status: "ok",
  endpoint,
  includeUsage,
  multiCheckEnforced: !allowSingle,
  disconnectedEarly: abortedEarly,
  abortReason,
  uniqueToolCallCount: uniqueToolIds.size,
  roleFirstSeen: hasRoleFirst,
  finishReasons,
  doneFrames: doneFrames.length,
  logPath,
  hashPath,
  sha256: hash,
  manifest: manifestPath,
};

console.log(JSON.stringify(verdict));
console.log(
  `SMOKE OK: tool-call stream (${expectXml ? "textual" : "structured"}${
    disconnectAfterFirstTool ? ", disconnect" : ""
  }); role-first=${hasRoleFirst}; finish=${finishReasons.join(",") || "none"}; done=${
    doneFrames.length
  }; manifest=${manifestPath}`
);
