# Copilot Auto-Detection Tasks (proxy)

## Background
- Plan doc: `docs/plans/2025-12-23-copilot-auto-detection.md`
- Goal: detect Obsidian Copilot reliably enough to switch only those requests to
  `obsidian-xml`, while keeping other clients on `openai-json`.

## Scope
- In scope:
  - Feature-flagged Copilot detection using existing signals (headers + markers).
  - Apply detection to `/v1/responses` output mode selection.
  - Emit shape-only detection fields in structured logs.
- Out of scope:
  - Client changes in Obsidian Copilot.
  - Persisting or logging raw prompt content.
  - Changing default `x-proxy-output-mode` precedence.

## Feature flag
- Name: `PROXY_COPILOT_AUTO_DETECT`
- Default: `false` (off by default)

## Tasks

- [ ] **T1: Config + detection result contract**
  - Add `PROXY_COPILOT_AUTO_DETECT` to `src/config/index.js`.
  - Define a detection result shape used consistently across handlers.
  - Proposed shape:
    - `copilot_detected: boolean`
    - `copilot_detect_tier: "high"|"suspected"|null`
    - `copilot_detect_reasons: string[]` (bounded list)

- [ ] **T2: Implement classifier helper**
  - Add a shared helper (e.g., `src/lib/copilot-detect.js`).
  - Inputs:
    - Headers (`x-copilot-trace-id`, `HTTP-Referer`, `X-Title`, UA)
    - Marker detection:
      - For chat: `detectIngressMarkers(messages)` from `src/lib/ingress-guardrail.js`
      - For responses: markers already computed in `summarizeResponsesIngress(...)`
  - High-confidence triggers (apply `obsidian-xml`):
    - `x-copilot-trace-id` present
    - `<recent_conversations>` or `<saved_memories>` markers
    - Both OpenRouter headers present:
      - `HTTP-Referer: https://obsidiancopilot.com`
      - `X-Title: Obsidian Copilot`
  - Suspected triggers (log-only):
    - UA indicates Obsidian or `un/JS`, plus at least one weak signal:
      - `<use_tool>` marker
      - `Tool '…' result:` marker
      - Responses input shape match (as per fixtures)

- [ ] **T3: Wire detection into output mode resolution**
  - Update `resolveResponsesOutputMode` in `src/handlers/responses/shared.js`:
    - If `PROXY_COPILOT_AUTO_DETECT` is on and tier is `high`, force `copilotDefault`.
    - Preserve `x-proxy-output-mode` override precedence.
    - Suspected tier logs only (no output-mode change).

- [ ] **T4: Emit detection fields in logs**
  - Add `copilot_detect_*` fields to:
    - `access_log` in `src/middleware/access-log.js`
    - `responses_ingress_raw` in `src/handlers/responses/ingress-logging.js`
    - Optional: `ingress_guardrail_injected` in `src/lib/ingress-guardrail.js`

- [ ] **T5: Tests**
  - Add or update tests listed in "Test plan" below.

## Acceptance Criteria

1. **Feature flag** exists and defaults to off.
2. **High-confidence detection** switches `/v1/responses` to `obsidian-xml` when
   enabled, without affecting other requests.
3. **Suspected detection** never changes output mode (log-only).
4. **Explicit `x-proxy-output-mode`** continues to override detection.
5. **Structured logs** include:
   - `copilot_detected`
   - `copilot_detect_tier`
   - `copilot_detect_reasons`
6. **No raw prompt content** is logged to support detection.

## Test plan (map to ACs)

### Unit tests
- **New:** `tests/unit/lib/copilot-detect.spec.js`
  - AC2: `x-copilot-trace-id` -> tier `high`
  - AC2: `<recent_conversations>` marker -> tier `high`
  - AC2: OpenRouter headers -> tier `high`
  - AC3: UA-only -> `suspected` or `null`, not `high`
  - AC3: `<use_tool>` only -> `suspected`
- **Update:** `tests/unit/responses-output-mode.copilot.spec.js`
  - AC1/AC4: flag off keeps current behavior
  - AC2: flag on + high tier forces `obsidian-xml`
  - AC3: flag on + suspected tier does not force
  - AC4: explicit `x-proxy-output-mode` still wins
- **Update:** `tests/unit/handlers/responses/ingress-logging.spec.js`
  - AC5: `copilot_detect_*` fields included in `responses_ingress_raw`

### Integration tests
- **Update:** `tests/integration/responses.output-mode.copilot.int.test.js`
  - AC2: With `PROXY_COPILOT_AUTO_DETECT=true`, a request containing
    `<recent_conversations>` in `input` results in `x-proxy-output-mode: obsidian-xml`.
  - AC3: UA-only does not force `obsidian-xml`.
- **Optional:** Add an access-log stdout capture test to confirm `copilot_detect_*`
  fields appear on `access_log` entries (AC5).

### Manual verification (dev/staging)
- Send a `/v1/responses` request with:
  - `<recent_conversations>` content and no `x-proxy-output-mode`.
  - Confirm `x-proxy-output-mode: obsidian-xml` and log fields in `responses_ingress_raw`.
- Send a non-Copilot request (generic UA, no markers).
  - Confirm `x-proxy-output-mode` remains default and log fields show `copilot_detected=false`.

