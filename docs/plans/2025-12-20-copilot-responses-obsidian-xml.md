# Copilot Responses Output Mode (obsidian-xml) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Force `obsidian-xml` output mode for Obsidian Copilot `/v1/responses` traffic when the client does not explicitly set `x-proxy-output-mode`, so XML `<use_tool>` blocks are preserved in streaming and tool calls remain detectable.

**Architecture:** Add a small request classifier for Copilot traffic (based on User-Agent and/or trace headers) and use it to override the default Responses output mode before delegating to the shared chat handlers. Preserve explicit client overrides and keep non-Copilot traffic on the existing default (`openai-json`).

**Tech Stack:** Node.js, Express, Vitest (unit/integration tests), existing proxy handlers and logging.

---

## Acceptance Criteria (Checklist)
- [ ] **AC1:** For `/v1/responses`, when request headers indicate Copilot and `x-proxy-output-mode` is absent, the effective output mode is `obsidian-xml` (header + runtime behavior).
- [ ] **AC2:** If `x-proxy-output-mode` is explicitly set by the client, the proxy respects it even for Copilot traffic.
- [ ] **AC3:** Non-Copilot `/v1/responses` traffic continues to default to `PROXY_RESPONSES_OUTPUT_MODE` (currently `openai-json`).
- [ ] **AC4:** Streaming tool-call responses for Copilot include `<use_tool>` blocks in `response.output_text.delta` events.
- [ ] **AC5:** Documentation reflects the new Copilot auto-detection behavior and the override rules.

---

## Tests to Verify ACs (Checklist)
- [ ] **T1 (Unit):** Header classifier returns Copilot=true for `User-Agent: Obsidian/...` and for `x-copilot-trace-id`; returns false for generic agents.
- [ ] **T2 (Unit):** Output-mode resolver returns `obsidian-xml` for Copilot when header is absent, and preserves explicit `x-proxy-output-mode` values.
- [ ] **T3 (Integration, non-stream):** `/v1/responses` responds with `x-proxy-output-mode: obsidian-xml` when Copilot headers are set and client did not override.
- [ ] **T4 (Integration, streaming):** Copilot `/v1/responses` stream includes `<use_tool>` in `response.output_text.delta` for a tool-call fixture.
- [ ] **T5 (Docs):** Updated docs reviewed for correctness (no conflicting guidance).

---

## Task 0: Prep and worktree

**Files:**
- None

**Step 0.1: Create a worktree (required)**
- [ ] Run @superpowers:using-git-worktrees to create an isolated worktree for implementation.

**Step 0.2: Verify baseline**
- [ ] Run: `npm run test:unit -- --help`
- Expected: command prints usage and exits 0 (sanity check).

---

## Task 1: Add Copilot header detection helper (unit-test first)

**Files:**
- Modify: `src/handlers/responses/shared.js`
- Create: `tests/unit/responses-output-mode.copilot.spec.js`

**Step 1.1: Write the failing unit test**
- [ ] Create `tests/unit/responses-output-mode.copilot.spec.js`:

```js
import { describe, expect, it } from "vitest";
import { detectCopilotRequest, resolveResponsesOutputMode } from "../../src/handlers/responses/shared.js";

describe("responses output mode for Copilot", () => {
  it("detects Copilot via User-Agent", () => {
    const req = { headers: { "user-agent": "obsidian/1.9.7 Electron/37.2.4" } };
    expect(detectCopilotRequest(req)).toBe(true);
  });

  it("detects Copilot via trace header", () => {
    const req = { headers: { "x-copilot-trace-id": "copilot-test" } };
    expect(detectCopilotRequest(req)).toBe(true);
  });

  it("does not detect generic clients", () => {
    const req = { headers: { "user-agent": "curl/8.0" } };
    expect(detectCopilotRequest(req)).toBe(false);
  });

  it("forces obsidian-xml for Copilot when header absent", () => {
    const req = { headers: { "user-agent": "obsidian/1.9.7" } };
    const result = resolveResponsesOutputMode({
      req,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
    });
    expect(result.effective).toBe("obsidian-xml");
    expect(result.source).toBe("copilot");
  });

  it("respects explicit x-proxy-output-mode", () => {
    const req = {
      headers: {
        "user-agent": "obsidian/1.9.7",
        "x-proxy-output-mode": "openai-json",
      },
    };
    const result = resolveResponsesOutputMode({
      req,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
    });
    expect(result.effective).toBe("openai-json");
    expect(result.source).toBe("header");
  });
});
```

**Step 1.2: Run the unit test and confirm it fails**
- [ ] Run: `npm run test:unit -- tests/unit/responses-output-mode.copilot.spec.js`
- Expected: FAIL (missing exported helpers).

**Step 1.3: Implement detection + resolver (minimal code)**
- [ ] In `src/handlers/responses/shared.js`, add helpers:

```js
export const detectCopilotRequest = (req) => {
  const headers = req?.headers || {};
  const ua = String(headers["user-agent"] || "").toLowerCase();
  const hasTrace = Boolean(headers["x-copilot-trace-id"] || headers["x-trace-id"]);
  return ua.includes("obsidian/") || hasTrace;
};

export const resolveResponsesOutputMode = ({ req, defaultValue, copilotDefault }) => {
  const explicit = req?.headers?.["x-proxy-output-mode"];
  if (explicit && String(explicit).trim()) {
    return { effective: String(explicit).trim(), source: "header" };
  }
  if (copilotDefault && detectCopilotRequest(req)) {
    return { effective: copilotDefault, source: "copilot" };
  }
  return { effective: defaultValue, source: "default" };
};
```

**Step 1.4: Re-run the unit test**
- [ ] Run: `npm run test:unit -- tests/unit/responses-output-mode.copilot.spec.js`
- Expected: PASS.

**Step 1.5: Commit**
- [ ] `git add tests/unit/responses-output-mode.copilot.spec.js src/handlers/responses/shared.js`
- [ ] `git commit -m "test(responses): cover copilot output mode resolver"`

---

## Task 2: Wire the resolver into `/v1/responses` handlers

**Files:**
- Modify: `src/handlers/responses/stream.js`
- Modify: `src/handlers/responses/nonstream.js`

**Step 2.1: Update streaming handler to apply Copilot default**
- [ ] In `src/handlers/responses/stream.js`, replace direct use of `CFG.PROXY_RESPONSES_OUTPUT_MODE` with the resolver:

```js
const { resolveResponsesOutputMode } = await import("./shared.js");
const { effective } = resolveResponsesOutputMode({
  req,
  defaultValue: CFG.PROXY_RESPONSES_OUTPUT_MODE,
  copilotDefault: "obsidian-xml",
});
const restoreOutputMode = applyDefaultProxyOutputModeHeader(req, effective);
```

**Step 2.2: Update non-stream handler similarly**
- [ ] Apply the same resolver logic in `src/handlers/responses/nonstream.js` before `applyDefaultProxyOutputModeHeader`.

**Step 2.3: Run targeted unit tests**
- [ ] Run: `npm run test:unit -- tests/unit/responses-output-mode.copilot.spec.js`
- Expected: PASS.

**Step 2.4: Commit**
- [ ] `git add src/handlers/responses/stream.js src/handlers/responses/nonstream.js`
- [ ] `git commit -m "fix(responses): default copilot output mode to obsidian-xml"`

---

## Task 3: Add integration coverage for Copilot output mode

**Files:**
- Create: `tests/integration/responses.output-mode.copilot.int.test.js`

**Step 3.1: Write failing integration test**
- [ ] Create `tests/integration/responses.output-mode.copilot.int.test.js`:

```js
import { describe, expect, it } from "vitest";
import { createTestServer } from "./helpers/test-server.js";

const COPILOT_UA = "obsidian/1.9.7 Electron/37.2.4";

describe("/v1/responses copilot output mode", () => {
  it("forces obsidian-xml when Copilot headers are present", async () => {
    const server = await createTestServer();
    const res = await server.post("/v1/responses", {
      headers: { "User-Agent": COPILOT_UA },
      body: { model: "gpt-5", input: "ping", stream: false },
    });
    expect(res.headers["x-proxy-output-mode"]).toBe("obsidian-xml");
  });
});
```

**Step 3.2: Run integration test to confirm fail**
- [ ] Run: `npm run test:integration -- tests/integration/responses.output-mode.copilot.int.test.js`
- Expected: FAIL if header not set yet, PASS after wiring.

**Step 3.3: Add streaming XML assertion**
- [ ] Extend the test to request a tool-call fixture and assert `<use_tool>` appears in `response.output_text.delta` when `User-Agent` is Copilot. Use the existing fake Codex shim or fixture harness in `tests/integration` to generate a tool-call stream.

**Step 3.4: Re-run integration test**
- [ ] Run: `npm run test:integration -- tests/integration/responses.output-mode.copilot.int.test.js`
- Expected: PASS.

**Step 3.5: Commit**
- [ ] `git add tests/integration/responses.output-mode.copilot.int.test.js`
- [ ] `git commit -m "test(responses): enforce copilot obsidian-xml mode"`

---

## Task 4: Documentation update

**Files:**
- Modify: `docs/responses-endpoint/overview.md`

**Step 4.1: Update docs**
- [ ] Add a short note explaining Copilot auto-detection and that explicit `x-proxy-output-mode` always wins.

**Step 4.2: Docs check**
- [ ] Run: `npm run lint:runbooks` (or `prettier -c docs/responses-endpoint/overview.md` if you only changed that file)
- Expected: PASS.

**Step 4.3: Commit**
- [ ] `git add docs/responses-endpoint/overview.md`
- [ ] `git commit -m "docs(responses): document copilot output-mode override"`

---

## Final verification
- [ ] Run: `npm run test:unit -- tests/unit/responses-output-mode.copilot.spec.js`
- [ ] Run: `npm run test:integration -- tests/integration/responses.output-mode.copilot.int.test.js`
- [ ] If all pass, summarize changes and link to ACs.
