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
const expectXml = args.has("--expect-xml");
const useResponses =
  args.has("--responses") ||
  args.has("--responses-endpoint") ||
  String(process.env.TOOL_SMOKE_ENDPOINT || "").toLowerCase() === "responses";
const allowSingle = args.has("--allow-single") || disconnectAfterFirstTool || useResponses;
const allowMissingTools =
  args.has("--allow-missing-tools") ||
  args.has("--allow-missing-tool-calls") ||
  /^(1|true|yes)$/i.test(String(process.env.TOOL_SMOKE_ALLOW_MISSING || ""));
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:11435";
const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
const endpoint = useResponses
  ? `${trimmedBase}/v1/responses`
  : `${trimmedBase}/v1/chat/completions`;
const apiKey = process.env.KEY || process.env.PROXY_API_KEY;
const toolName = process.env.TOOL_SMOKE_TOOL || "exec_command";
const toolCmd = process.env.TOOL_SMOKE_CMD || "echo smoke";

if (!apiKey) {
  console.error("Missing KEY or PROXY_API_KEY environment variable.");
  process.exit(1);
}

const structuredPrompt = `Use ${toolName} with cmd="${toolCmd}" and return tool output.`;
const xmlPrompt = [
  `Return exactly one <use_tool name="${toolName}"> block with JSON.`,
  `Use {"cmd":"${toolCmd}"} as the payload and output nothing else.`,
  `<use_tool name="${toolName}">{"cmd":"${toolCmd}"}</use_tool>`,
].join("\n");

const baseRequest = {
  model: process.env.MODEL || "codex-5",
  stream: true,
};

const requestBody = useResponses
  ? {
      ...baseRequest,
      input: expectXml ? xmlPrompt : structuredPrompt,
    }
  : {
      ...baseRequest,
      messages: [{ role: "user", content: expectXml ? xmlPrompt : structuredPrompt }],
    };

if (!expectXml) {
  requestBody.tools = [
    {
      type: "function",
      function: {
        name: toolName,
        description: "Runs a command in a PTY",
        parameters: {
          type: "object",
          properties: {
            cmd: { type: "string" },
          },
          required: ["cmd"],
        },
      },
    },
  ];
  requestBody.tool_choice = { type: "function", function: { name: toolName } };
}

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
      "x-proxy-output-mode": expectXml ? "obsidian-xml" : "openai-json",
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
const dataEntries = entries.filter((entry) => entry?.type === "data");
const doneFrames = entries.filter((entry) => entry?.type === "done");
let uniqueToolIds = new Set();
let finishReasons = [];
let hasRoleFirst = false;
let toolCallsMissing = false;

if (useResponses) {
  if (!expectXml) {
    const addedEntries = dataEntries.filter(
      (entry) => entry.event === "response.output_item.added"
    );
    uniqueToolIds = new Set(
      addedEntries
        .map((entry) => entry.data?.item?.id)
        .filter((id) => typeof id === "string" && id.length > 0)
    );
    const minCalls = allowSingle ? 1 : 2;
    if (uniqueToolIds.size < minCalls) {
      const completedEntry = dataEntries.find((entry) => entry.event === "response.completed");
      const responseOutput = completedEntry?.data?.response?.output || [];
      const hasToolUse = responseOutput.some((item) =>
        item?.content?.some?.((content) => content?.type === "tool_use")
      );
      const toolEvidence = uniqueToolIds.size > 0 || hasToolUse;
      if (allowMissingTools && !toolEvidence) {
        toolCallsMissing = true;
      } else {
        console.error(
          `Expected at least ${minCalls} tool call(s) in responses stream but found ${uniqueToolIds.size}.`
        );
        process.exit(1);
      }
    }
    const completedEntry = dataEntries.find((entry) => entry.event === "response.completed");
    if (!completedEntry) {
      console.error("Missing response.completed event in responses stream.");
      process.exit(1);
    }
    const responseOutput = completedEntry.data?.response?.output || [];
    const hasToolUse = responseOutput.some((item) =>
      item?.content?.some?.((content) => content?.type === "tool_use")
    );
    if (!hasToolUse) {
      const toolEvidence = uniqueToolIds.size > 0 || hasToolUse;
      if (allowMissingTools && !toolEvidence) {
        toolCallsMissing = true;
      } else {
        console.error("Missing tool_use content in response.completed output.");
        process.exit(1);
      }
    }
    finishReasons = [completedEntry.data?.response?.status || "completed"];
  }
} else {
  for (const entry of dataEntries) {
    const choices = Array.isArray(entry.data?.choices) ? entry.data.choices : [];
    for (const choice of choices) {
      const deltas = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
      deltas.forEach((call) => {
        if (call?.id) uniqueToolIds.add(call.id);
      });
      if (choice?.finish_reason) finishReasons.push(choice.finish_reason);
    }
  }
  if (!expectXml) {
    const minCalls = allowSingle ? 1 : 2;
    if (uniqueToolIds.size < minCalls) {
      const toolEvidence = uniqueToolIds.size > 0;
      if (allowMissingTools && !toolEvidence) {
        toolCallsMissing = true;
      } else {
        console.error(
          `Expected at least ${minCalls} unique tool calls in stream but found ${uniqueToolIds.size}. ` +
            "Use --allow-single to skip this check."
        );
        process.exit(1);
      }
    }
  }

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

  if (!expectXml) {
    if (!toolCallsMissing && !finishReasons.includes("tool_calls")) {
      console.error("Missing finish_reason: tool_calls in stream.");
      process.exit(1);
    }
  }

  // Role-first exactly once per choice
  const roleFirstIndex = dataEntries.findIndex((entry) =>
    entry.data?.choices?.some((choice) => choice?.delta?.role === "assistant")
  );
  hasRoleFirst = roleFirstIndex !== -1;
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
  const contentText = useResponses
    ? dataEntries
        .filter((entry) => entry.event === "response.output_text.delta")
        .map((entry) => (typeof entry.data?.delta === "string" ? entry.data.delta : ""))
        .join("")
    : dataEntries
        .flatMap((entry) => entry.data?.choices || [])
        .map((choice) => (typeof choice?.delta?.content === "string" ? choice.delta.content : ""))
        .join("");

  if (!contentText.includes("<use_tool")) {
    if (allowMissingTools) {
      toolCallsMissing = true;
    } else {
      console.error("Expected XML <use_tool> content but none was found.");
      process.exit(1);
    }
  }
  if (!toolCallsMissing) {
    const closeIdx = contentText.lastIndexOf("</use_tool>");
    if (closeIdx < 0) {
      console.error("XML <use_tool> block is not properly terminated.");
      process.exit(1);
    }
    const tail = contentText.slice(closeIdx + "</use_tool>".length).trim();
    if (tail.length > 0) {
      console.error(
        "Found trailing assistant content after <use_tool> block; tail should be stripped."
      );
      process.exit(1);
    }
  }
}

if (disconnectAfterFirstTool && !toolCallsMissing) {
  if (!useResponses) {
    const finishFrames = dataEntries.filter((entry) =>
      entry.data?.choices?.some((choice) => choice.finish_reason)
    );
    if (finishFrames.length > 0) {
      console.error("Expected no finish frames after client disconnect.");
      process.exit(1);
    }
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
  toolCallsMissing,
  roleFirstSeen: hasRoleFirst,
  finishReasons,
  doneFrames: doneFrames.length,
  logPath,
  hashPath,
  sha256: hash,
  manifest: manifestPath,
};

if (toolCallsMissing) {
  console.warn(
    "SMOKE WARN: tool calls missing; skipping tool-call assertions. " +
      "Set TOOL_SMOKE_ALLOW_MISSING=0 or drop --allow-missing-tools to enforce."
  );
}

console.log(JSON.stringify(verdict));
console.log(
  `SMOKE OK: tool-call stream (${expectXml ? "textual" : "structured"}${
    disconnectAfterFirstTool ? ", disconnect" : ""
  }); role-first=${hasRoleFirst}; finish=${finishReasons.join(",") || "none"}; done=${
    doneFrames.length
  }; tool-calls-missing=${toolCallsMissing}; manifest=${manifestPath}`
);
