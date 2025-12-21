# Copilot Auto-Detection for Chat Completions Implementation Plan

**Goal:** Add feature-flagged Copilot auto-detection for `/v1/chat/completions` that mirrors the responses behavior (high-confidence only, header override always wins).

**Architecture:** Compute detection from headers + chat markers, store `copilot_detect_*` in `res.locals`, and allow high-tier detection to override output mode when `PROXY_COPILOT_AUTO_DETECT=true` and no explicit `x-proxy-output-mode` is set.

**Tech Stack:** Node.js, Express handlers, Vitest unit tests.

## Goal
- Extend chat output-mode resolution to accept Copilot detection.
- Compute Copilot detection for chat requests using existing markers and headers.
- Log detection fields via `access_log` (already uses `res.locals`).

## Assumptions / constraints
- `PROXY_COPILOT_AUTO_DETECT` remains the single feature flag.
- Only high-confidence detection changes output mode.
- `x-proxy-output-mode` always overrides detection.
- No raw content logging added.

## Research (current state)
- Relevant files/entrypoints:
  - `src/handlers/chat/nonstream.js` (chat output mode resolution)
  - `src/handlers/chat/stream.js` (chat output mode resolution)
  - `src/handlers/chat/shared.js` (`resolveOutputMode`)
  - `src/lib/ingress-guardrail.js` (`detectIngressMarkers`)
  - `src/lib/copilot-detect.js` (classifier)
  - `src/middleware/access-log.js` (logs `copilot_detect_*` from `res.locals`)
- Existing patterns to follow:
  - `src/handlers/responses/shared.js` (`resolveResponsesOutputMode` with detection)
  - `src/handlers/responses/nonstream.js` / `stream.js` detection wiring

## Analysis
### Options
1) Extend `resolveOutputMode` to accept `copilotDetection` and apply detection in chat handlers (minimal change).
2) Create a new chat-specific resolver and keep `resolveOutputMode` unchanged.
3) Refactor a shared resolver for chat + responses (higher risk).

### Decision
- Chosen: Option 1.
- Why: Minimal diff, mirrors existing responses behavior, no refactor risk.

### Risks / edge cases
- Guardrail disabled: ensure detection still scans messages for markers.
- Messages mutated after guardrail injection: rely on `guardrailResult.markers` to avoid re-scanning.

### Open questions
- None (user approved mirroring responses behavior).

## Q&A (answer before implementation)
- Approved: same precedence as responses; proceed without more questions.

## Implementation plan

### Task 1: Extend chat output-mode resolver for Copilot detection

**Files:**
- Modify: `src/handlers/chat/shared.js`
- Test: `tests/unit/handlers/chat/output-mode.copilot.spec.js`

**Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { resolveOutputMode } from "../../../src/handlers/chat/shared.js";

describe("chat output mode for Copilot", () => {
  it("forces obsidian-xml for high-confidence detection when header absent", () => {
    const result = resolveOutputMode({
      headerValue: null,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
      copilotDetection: {
        copilot_detected: true,
        copilot_detect_tier: "high",
        copilot_detect_reasons: ["marker_recent_conversations"],
      },
    });
    expect(result).toBe("obsidian-xml");
  });

  it("does not force obsidian-xml for suspected detection", () => {
    const result = resolveOutputMode({
      headerValue: null,
      defaultValue: "openai-json",
      copilotDefault: "obsidian-xml",
      copilotDetection: {
        copilot_detected: true,
        copilot_detect_tier: "suspected",
        copilot_detect_reasons: ["ua_obsidian"],
      },
    });
    expect(result).toBe("openai-json");
  });

  it("respects explicit header even with high-confidence detection", () => {
    const result = resolveOutputMode({
      headerValue: "openai-json",
      defaultValue: "obsidian-xml",
      copilotDefault: "obsidian-xml",
      copilotDetection: {
        copilot_detected: true,
        copilot_detect_tier: "high",
        copilot_detect_reasons: ["marker_recent_conversations"],
      },
    });
    expect(result).toBe("openai-json");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/handlers/chat/output-mode.copilot.spec.js`
Expected: FAIL because `resolveOutputMode` ignores `copilotDetection`.

**Step 3: Write minimal implementation**

Update `resolveOutputMode` to accept optional `copilotDetection` and `copilotDefault`.
When no header is present and `copilotDetection.copilot_detect_tier === "high"`, return `copilotDefault`.

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/handlers/chat/output-mode.copilot.spec.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add tests/unit/handlers/chat/output-mode.copilot.spec.js src/handlers/chat/shared.js
git commit -m "feat(copilot): extend chat output-mode resolver"
```

### Task 2: Compute detection in chat handlers and apply output mode

**Files:**
- Modify: `src/handlers/chat/nonstream.js`
- Modify: `src/handlers/chat/stream.js`
- Modify: `src/lib/ingress-guardrail.js` (only if needed for saved memories log fields)
- Test: `tests/unit/handlers/chat/output-mode.copilot.spec.js` (extend if needed)
- Test: `tests/integration/chat.output-mode.copilot.int.test.js`

**Step 1: Write failing test**

Add `tests/integration/chat.output-mode.copilot.int.test.js` to assert that when `PROXY_OUTPUT_MODE=openai-json` and `PROXY_COPILOT_AUTO_DETECT=true`, a `<recent_conversations>` marker forces the `x-proxy-output-mode` header to `obsidian-xml`.

**Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/chat.output-mode.copilot.int.test.js`
Expected: FAIL because chat handlers do not pass detection.

**Step 3: Write minimal implementation**

- In `chat/nonstream.js` and `chat/stream.js`:
  - After guardrail detection, compute `markers` from `guardrailResult.markers` or `detectIngressMarkers(messages)`.
  - Call `detectCopilotRequest({ headers: req.headers, markers })`.
  - Set `res.locals.copilot_detect_*`.
  - Pass detection into `resolveOutputMode` only when `PROXY_COPILOT_AUTO_DETECT` is `true`.

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/integration/chat.output-mode.copilot.int.test.js --reporter=default`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/handlers/chat/nonstream.js src/handlers/chat/stream.js tests/unit/handlers/chat/output-mode.copilot.spec.js
git commit -m "feat(copilot): detect chat requests for output mode"
```

### Task 3: Full unit test run

**Files:**
- No additional files.

**Step 1: Run unit tests**

Run: `npm run test:unit`
Expected: PASS.

## Tests to run
- `npm run test:unit -- tests/unit/handlers/chat/output-mode.copilot.spec.js`
- `./node_modules/.bin/vitest run tests/integration/chat.output-mode.copilot.int.test.js --reporter=default`
- `npm run test:unit`
