# Codex Execution Checklist — Codex Completions API Hardening Sprint (v3)

## Title and Scope

This checklist is an implementation-ready plan for hardening **DrJLabs/codex-completions-api** across four areas:

1. **API authentication**: eliminate a security regression risk caused by a usage-specific auth bypass being reused on sensitive endpoints; centralize and make auth intent explicit.
2. **Request validation & error shaping**: ensure malformed JSON never produces HTML error pages and that validations remain consistent across `/v1/chat/completions` and legacy `/v1/completions`.
3. **Feature flags**: standardize boolean parsing to accept common truthy values (`1`, `yes`, `on`) to reduce operator error.
4. **Codex CLI integration hardening**: prevent secret env var leakage into spawned processes, improve config quoting, and auto-restart the worker on “stuck handshake” (startup readiness timeout).

**Analyzed code reference:** All code permalinks below reference commit `b3e7b3f81ebd8de52492d1aef98ae7cd20218266` as returned by the GitHub connector. I cannot confirm from the connector whether this commit is the current `main` HEAD; treat it as the analyzed snapshot.

## Source Inputs

### Attached review reports (in-repo under `docs/review/`)

These four reports are referenced throughout this checklist and are committed under `docs/review/`:

- [docs/review/enforce_api_key_auth_report.md](docs/review/enforce_api_key_auth_report.md)  
  External filename: `enforce_api_key_auth_report.md`
- [docs/review/add-input-validation-completions-requests-report.md](docs/review/add-input-validation-completions-requests-report.md)  
  External filename: `add-input-validation-completions-requests-report.md`
- [docs/review/feature_flag_gating_report.md](docs/review/feature_flag_gating_report.md)  
  External filename: `feature_flag_gating_report.md`
- [docs/review/codex_cli_integration_audit_report.md](docs/review/codex_cli_integration_audit_report.md)  
  External filename: `codex_cli_integration_audit_report.md`

### Peer AI review (provided in chat)

- “Critical Security Fixes / Resolved Unknowns / Refined Task List & Improvements” (review text in the user prompt).  
  Key callout validated against the codebase: `requireApiKey` bypasses auth when `PROXY_USAGE_ALLOW_UNAUTH` is enabled, which is safe for `/v1/usage` but dangerous if reused on chat/responses.

### Existing in-repo supporting docs (present in analyzed snapshot)

- `docs/review/codex-completions-api_docs_audit_plan.md`
- `docs/review/codex-completions-api_local-run.md`
- `docs/review/codex-completions-api_project-audit.md`
- `docs/review/codex-completions-api_release-checklist.md`
- `docs/review/codex-completions-api_tests_audit.md`
- `docs/review/codex-completions-api_troubleshooting.md`

## How to Use This Checklist With Codex

1. Work **phase-by-phase** in order; do not parallelize phases unless dependencies are satisfied.
2. For each checklist item:
   - Implement exactly what is specified in **Change summary**.
   - Validate each **Acceptance Criteria** using the mapped tests.
   - Add/extend tests before declaring completion.
3. Prefer small, reviewable PRs following the **Suggested PR Plan** at the end.

## Execution Order (Phases)

- **Phase 0 — Baseline & Source Sync**
- **Phase 1 — Authentication Hardening**
- **Phase 2 — Validation & Error Shaping**
- **Phase 3 — Feature Flags & Config Parsing**
- **Phase 4 — Codex CLI Hardening**
- **Phase 5 — Final Verification & Docs**

## Master Checklist

### Phase 0 — Baseline & Source Sync

- [x] ID: DOCS-01
  Title: Add the four audit reports to `docs/review/` and wire stable links
  Source(s): `enforce_api_key_auth_report.md`; `add-input-validation-completions-requests-report.md`; `feature_flag_gating_report.md`; `codex_cli_integration_audit_report.md` (external inputs)
  Why / Risk:
  - The checklist must link stable in-repo copies of the authoritative requirements.
  - Without committing these docs, future readers cannot validate intent vs implementation.
  Dependencies: none
  Implementation (code references):
  - Existing code: `docs/review/` folder exists (example file)  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/docs/review/codex-completions-api_project-audit.md>
  - Change summary: Add the four provided markdown reports to `docs/review/` with the exact filenames referenced in **Source Inputs**; update any internal references in docs/review index files if present.
  Acceptance Criteria:
  - AC1: The repo contains all four files under `docs/review/` with stable paths.
  - AC2: All links in this checklist resolve as relative links in GitHub.
  Tests (mapped to ACs):
  - For AC1: N/A (repo content check)
  - For AC2: N/A (link check)
  Config / Flags impact:
  - None
  Observability / Logging (if relevant):
  - None
  Docs impact:
  - `docs/review/*` (add new files)
  Definition of Done:
  - Files added and reviewed for completeness
  - CI passes

- [x] ID: BASE-01
  Title: Run baseline tests and capture current behavior for auth/flags/worker
  Source(s): `docs/review/codex-completions-api_tests_audit.md`; `package.json` scripts
  Why / Risk:
  - Prevent accidental regressions while refactoring security-critical paths.
  - Establish expected status codes and error shapes before changes.
  Dependencies: DOCS-01 (recommended), none (required)
  Implementation (code references):
  - Existing code: `package.json` scripts  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/package.json#L5-L19>
  - Change summary: Run `npm test`, `npm run test:integration`, and `npm run test:unit`. Record baseline outcomes for:
    - 401 behavior on `/v1/chat/completions`, `/v1/completions`, `/v1/responses`
    - 404/enablement behavior for `/v1/responses` when flag disabled
    - Worker supervisor restart behavior (unit tests)
  Acceptance Criteria:
  - AC1: All tests pass before any code changes.
  - AC2: Baseline notes captured in PR description(s) for quick comparison.
  Tests (mapped to ACs):
  - For AC1: `npm test`
  - For AC2: N/A (process)
  Config / Flags impact:
  - None
  Observability / Logging (if relevant):
  - None
  Docs impact:
  - None
  Definition of Done:
  - Tests green
  - Baseline notes recorded

### Phase 1 — Authentication Hardening

- [x] ID: AUTH-01
  Title: Split auth middleware into strict vs usage-aware variants (prevent auth bypass reuse)
  Source(s): [docs/review/enforce_api_key_auth_report.md](docs/review/enforce_api_key_auth_report.md); peer AI review “Critical Security Fixes”
  Why / Risk:
  - Current `requireApiKey` intentionally bypasses auth when `PROXY_USAGE_ALLOW_UNAUTH` is set; reusing it for chat/responses would create a public API exposure risk.
  - Naming and behavior are currently coupled to usage semantics, increasing the chance of misuse.
  Dependencies: none
  Implementation (code references):
  - Existing code: `src/middleware/auth.js` exports `hasValidApiKey`, `requireApiKey`, `requireTestAuth`  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/middleware/auth.js#L3-L39>
  - Change summary:
    - Introduce `requireStrictAuth(req,res,next)` that **always** enforces the bearer token check (ignores `PROXY_USAGE_ALLOW_UNAUTH`).
    - Rename existing `requireApiKey` logic to `requireUsageAuth` (or keep `requireApiKey` as a backwards-compatible alias), preserving the bypass only for usage dashboards.
    - Harden token parsing by trimming after `Bearer ` (e.g., `auth.slice(7).trim()`).
  Acceptance Criteria:
  - AC1: `requireStrictAuth` returns `401` + `WWW-Authenticate: Bearer realm=api` when the token is missing/incorrect, even when `PROXY_USAGE_ALLOW_UNAUTH=true`.
  - AC2: `requireUsageAuth` allows requests through when `PROXY_USAGE_ALLOW_UNAUTH=true`; otherwise behaves like strict auth.
  - AC3: Existing imports compile (either by updating imports or keeping an alias export).
  Tests (mapped to ACs):
  - For AC1: Add **unit tests** for auth middleware (new file), e.g. `tests/unit/auth.middleware.test.js`:
    - Set `process.env.PROXY_USAGE_ALLOW_UNAUTH="true"` and `process.env.PROXY_API_KEY="secret"`.
    - Assert `requireStrictAuth` rejects missing auth.
  - For AC2: Same test file:
    - Assert `requireUsageAuth` bypasses when allow unauth is enabled.
  - For AC3: `npm run test:unit`
  Config / Flags impact:
  - `PROXY_USAGE_ALLOW_UNAUTH` remains: only affects usage auth, not chat/responses.
  Observability / Logging (if relevant):
  - Do not log `Authorization` header or token values.
  Docs impact:
  - Update README/auth docs to clarify distinction between usage unauth vs API auth (see AUTH-04 Docs impact).
  Definition of Done:
  - Unit tests added and passing
  - No routes accidentally changed yet (only middleware refactor)

- [x] ID: AUTH-02
  Title: Enforce strict auth at the chat/responses route layer and remove handler-level bearer checks
  Source(s): [docs/review/enforce_api_key_auth_report.md](docs/review/enforce_api_key_auth_report.md); peer AI review “Phase 1: API Authentication (Revised)”
  Why / Risk:
  - Auth checks in handlers are duplicated and case-sensitive (`auth.startsWith("Bearer ")`), which is inconsistent with middleware behavior.
  - Centralizing auth at the routing layer reduces the risk of unprotected handler variants and simplifies testing.
  Dependencies: AUTH-01
  Implementation (code references):
  - Existing code:
    - Chat routes mount both `/v1/chat/completions` and legacy `/v1/completions` in one file  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/routes/chat.js#L9-L35>
    - Responses routes mount `/v1/responses`  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/routes/responses.js#L6-L31>
    - Handler-level auth checks (to remove) exist in both stream and non-stream chat handlers  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/handlers/chat/nonstream.js#L49-L67>  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/handlers/chat/stream.js#L49-L67>
  - Change summary:
    - Add `requireStrictAuth` middleware to **both HEAD and POST** routes:
      - `POST /v1/chat/completions`
      - `POST /v1/completions`
      - `POST /v1/responses`
      - `HEAD /v1/chat/completions`
      - `HEAD /v1/completions`
      - `HEAD /v1/responses`
    - Ensure `requireStrictAuth` runs **before** `requireWorkerReady` (where applicable) to fail fast on auth without waiting for worker readiness.
    - Remove the duplicated bearer-token checks from `postChatNonStream` and `postChatStream` (and any indirect callers like responses handlers that delegate to chat).

  Acceptance Criteria:
  - AC1: `POST /v1/chat/completions` returns 401 without bearer token.
  - AC2: `POST /v1/completions` returns 401 without bearer token.
  - AC3: `POST /v1/responses` returns 401 without bearer token (when responses are enabled).
  - AC4: With `PROXY_USAGE_ALLOW_UNAUTH=true`, chat/responses **still** return 401 without bearer token (no auth leak regression).
  - AC5: Case-insensitive `Authorization: bearer <token>` is accepted.
  - AC6: `HEAD /v1/chat/completions` and `HEAD /v1/completions` return 401 without bearer token.
  - AC7: `HEAD /v1/responses` returns 401 without bearer token (when responses are enabled).
  - AC8: With a valid bearer token, all HEAD routes return **not-401** (prefer 200; `/v1/responses` may still return a worker readiness error if `requireWorkerReady` is enforced).

  Tests (mapped to ACs):
  - For AC1: Existing integration test  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/server.int.test.js#L57-L63>
  - For AC2: Existing integration test  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/completions.auth.int.test.js#L21-L44>
  - For AC3: Existing integration test  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/responses.auth.int.test.js#L18-L45>
  - For AC4: Add a new integration test (recommended location: extend `tests/integration/security-hardening.int.test.js`):
    - Set `PROXY_USAGE_ALLOW_UNAUTH=true`, `PROXY_API_KEY=secret`
    - `POST /v1/chat/completions` without `Authorization` → expect 401
    - `GET /v1/usage` without `Authorization` → expect 200
      Existing file: <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/security-hardening.int.test.js#L1-L66>
  - For AC5: Add assertion(s) in `tests/integration/completions.auth.int.test.js` using lowercase `bearer` scheme.

  - For AC6–AC8: Add a new integration test (recommended new file: `tests/integration/head.auth.int.test.js`) that:
    - issues `HEAD` requests to `/v1/chat/completions`, `/v1/completions`, `/v1/responses`
    - asserts 401 without `Authorization`
    - asserts not-401 with `Authorization: Bearer <token>` (and validates `WWW-Authenticate` header is absent on success).

  Config / Flags impact:
  - None beyond enforcing that `PROXY_USAGE_ALLOW_UNAUTH` never impacts chat/responses.
  Observability / Logging (if relevant):
  - Auth failures should remain low-noise; do not log request bodies for 401s.
  Docs impact:
  - Update README to clarify `/v1/usage` is the only endpoint affected by `PROXY_USAGE_ALLOW_UNAUTH`.
  - If any docs mention handler-level auth, update them to reference middleware.
  Definition of Done:
  - Handler-level auth checks removed
  - Integration tests pass and include the regression test for `PROXY_USAGE_ALLOW_UNAUTH`

- [x] ID: AUTH-03
  Title: Refactor `/v1/models` protection to use strict auth middleware (when enabled)
  Source(s): [docs/review/enforce_api_key_auth_report.md](docs/review/enforce_api_key_auth_report.md)
  Why / Risk:
  - Models auth logic is currently duplicated and case-sensitive; aligning with middleware reduces drift.
  - Keeps `PROXY_PROTECT_MODELS` semantics intact while using a single auth implementation.
  Dependencies: AUTH-01
  Implementation (code references):
  - Existing code: models router performs inline bearer parsing gated by `CFG.PROTECT_MODELS`  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/routes/models.js#L1-L44>
  - Change summary:
    - When `CFG.PROTECT_MODELS` is true, apply `requireStrictAuth` as middleware (e.g., `r.use(requireStrictAuth)` before defining routes).
    - Remove the duplicated inline bearer parsing from `listModels`.
  Acceptance Criteria:
  - AC1: With `PROXY_PROTECT_MODELS=true`, `GET /v1/models` returns 401 without bearer.
  - AC2: With `PROXY_PROTECT_MODELS=false`, `GET /v1/models` remains publicly accessible.
  - AC3: Case-insensitive bearer scheme is accepted when protected.
  Tests (mapped to ACs):
  - For AC1–AC3: Existing integration test  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/routes.models.int.test.js#L1-L90>
  Config / Flags impact:
  - `PROXY_PROTECT_MODELS` unchanged (now benefits from boolish parsing in FLAGS-01).
  Observability / Logging (if relevant):
  - No credential logging.
  Docs impact:
  - If docs mention models auth specifics, update to say “uses standard API key auth when enabled”.
  Definition of Done:
  - Inline models auth removed
  - Tests remain green

- [x] ID: AUTH-04
  Title: Make usage auth intent explicit and add tests for `PROXY_USAGE_ALLOW_UNAUTH`
  Source(s): [docs/review/enforce_api_key_auth_report.md](docs/review/enforce_api_key_auth_report.md); README usage section
  Why / Risk:
  - `/v1/usage` is the only endpoint intended to optionally bypass auth; this must be explicit in code and covered by tests.
  - Prevent future “copy/paste” reuse of usage auth on sensitive endpoints.
  Dependencies: AUTH-01
  Implementation (code references):
  - Existing code:
    - Usage router uses `requireApiKey` for all `/v1/usage` paths  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/routes/usage.js#L1-L17>
    - README states `/v1/usage` requires bearer unless allow-unauth is set  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/README.md#L424-L427>
  - Change summary:
    - Update `src/routes/usage.js` to import and use `requireUsageAuth` (or keep `requireApiKey` as alias but prefer explicit name).
    - Add integration tests covering:
      - default behavior: `/v1/usage` 401 without bearer
      - allow-unauth behavior: `/v1/usage` 200 without bearer when `PROXY_USAGE_ALLOW_UNAUTH=true`
  Acceptance Criteria:
  - AC1: `/v1/usage` remains protected by default (401 without bearer).
  - AC2: `/v1/usage` is accessible without bearer when `PROXY_USAGE_ALLOW_UNAUTH=true`.
  - AC3: Changing `PROXY_USAGE_ALLOW_UNAUTH` does not impact `/v1/chat/completions` or `/v1/responses` (covered by AUTH-02 AC4).
  Tests (mapped to ACs):
  - For AC1: Add/extend integration test in `tests/integration/security-hardening.int.test.js`
  - For AC2: Same file; validate 200 and JSON content type.
  - For AC3: Covered by AUTH-02 regression test.
  Config / Flags impact:
  - `PROXY_USAGE_ALLOW_UNAUTH` now explicitly “usage-only”.
  Observability / Logging (if relevant):
  - Usage endpoint should not emit sensitive logs; ensure no token values logged.
  Docs impact:
  - README: clarify that `PROXY_USAGE_ALLOW_UNAUTH` only affects `/v1/usage`.
  Definition of Done:
  - Integration tests added and passing
  - Code reads clearly (no ambiguous `requireApiKey` naming for usage bypass)

### Phase 2 — Validation & Error Shaping

- [x] ID: VALID-01
  Title: Ensure invalid JSON bodies return OpenAI-style JSON errors (not HTML) and still get CORS/metrics/tracing
  Source(s): [docs/review/add-input-validation-completions-requests-report.md](docs/review/add-input-validation-completions-requests-report.md)
  Why / Risk:
  - Express’s default JSON parse error response can be HTML, which breaks API clients expecting JSON.
  - Current middleware ordering places CORS/tracing/metrics after `express.json`, so parse errors may miss these layers.
  Dependencies: none
  Implementation (code references):
  - Existing code:
    - `express.json()` is registered before tracing/CORS in `createApp()`  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/app.js#L18-L57>
    - OpenAI-style error helpers exist (`invalidRequestBody`)  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/lib/errors.js#L1-L44>
  - Change summary:
    - Reorder middleware so **tracing + metrics + CORS** run before `express.json()`.
    - Add an Express error-handling middleware (at the end of the chain) that:
      - detects JSON parse errors (commonly `SyntaxError` with `type === "entity.parse.failed"`)
      - responds `400` with `invalidRequestBody(null, "Invalid JSON")` (or equivalent)
      - sets `Content-Type: application/json`
  Acceptance Criteria:
  - AC1: `POST /v1/chat/completions` with malformed JSON returns 400 with JSON body `{ error: { type: "invalid_request_error", ... } }`.
  - AC2: Response is not HTML and has `Content-Type: application/json`.
  - AC3: CORS headers are present on the error response when CORS is enabled and an Origin is provided.
  - AC4: Metrics/tracing middleware still observe the request (at minimum, no runtime errors and request gets a request id).
  Tests (mapped to ACs):
  - For AC1–AC3: Add a new integration test file, e.g. `tests/integration/invalid-json.int.test.js`:
    - Send malformed JSON payload (`"{bad"`) with `Content-Type: application/json` and `Origin: <https://example.com>`
    - Assert status 400, JSON error shape, `content-type` includes `application/json`, and `access-control-allow-origin` is set appropriately.
  - For AC4: In the same test, assert presence of request id header if exposed (or, minimally, that the server responds successfully without crashing).
  Config / Flags impact:
  - `PROXY_ENABLE_CORS`, `PROXY_CORS_ALLOWED_ORIGINS` behavior unchanged; now applies even for parse errors.
  Observability / Logging (if relevant):
  - Do not log the malformed body content (to avoid accidental secret capture).
  Docs impact:
  - None required, but consider adding a short note in API docs about invalid JSON returning OpenAI error shape.
  Definition of Done:
  - Integration test added and passing
  - Middleware order change does not break existing integration tests

- [x] ID: VALID-02
  Title: Enforce `model` requiredness and align validation across legacy and chat completions
  Source(s): [docs/review/add-input-validation-completions-requests-report.md](docs/review/add-input-validation-completions-requests-report.md); peer AI review “Resolved Open Questions”
  Why / Risk:
  - The legacy route is a common compatibility shim; divergence causes inconsistent errors and harder debugging.
  - Future refactors (AUTH-02) must not accidentally break validation for `/v1/completions`.
  Dependencies: AUTH-02 (recommended), none (required)
  Implementation (code references):
  - Existing code:
    - Both endpoints are mounted in `src/routes/chat.js`  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/routes/chat.js#L9-L35>
    - Normalization supports `prompt` (legacy) and `messages` (chat)  
        <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/handlers/chat/request.js#L61-L132>
  - Change summary:
    - **Refactor `normalizeModel` to remove any default fallback** and enforce OpenAI-style requiredness:
      - If `model` is missing, null, or an empty string, return/throw a **400 invalid_request_error** (param: `model`) instead of defaulting.
      - Ensure both `/v1/chat/completions` and `/v1/completions` surface the same error shape for missing/empty model.
    - Add explicit integration coverage that:
      - `/v1/chat/completions` rejects when `model` is missing/empty.
      - `/v1/completions` rejects when `model` is missing/empty (legacy shim).
      - `/v1/completions` still accepts `prompt`-only payloads *when* `model` is present.

  Acceptance Criteria:
  - AC1: `POST /v1/chat/completions` returns 400 (OpenAI-style JSON error) when `model` is missing or `""`.
  - AC2: `POST /v1/completions` returns 400 (OpenAI-style JSON error) when `model` is missing or `""`.
  - AC3: Error bodies for AC1 and AC2 use the same `error.type` and set `error.param="model"` (or the repo’s equivalent).
  - AC4: With a non-empty `model`, legacy `prompt` is accepted on `/v1/completions` and is normalized (no “messages required” validation error when prompt is present).

  Tests (mapped to ACs):
  - For AC1–AC3: Add a new integration test file (recommended: `tests/integration/model-required.int.test.js`) that:
    - sends `POST /v1/chat/completions` without `model` (and with `model: ""`) and asserts 400 + JSON error shape
    - sends `POST /v1/completions` without `model` (and with `model: ""`) and asserts 400 + JSON error shape
  - For AC4: Extend an existing integration test (or add a small new one) that sends a legacy payload with `{ model: "codex-5", prompt: "hi" }` and asserts the request passes validation (i.e., not a 400 due to missing messages).

  Config / Flags impact:
  - None
  Observability / Logging (if relevant):
  - Ensure `endpoint_mode` continues to distinguish legacy vs chat for metrics/logging (`res.locals.endpoint_mode`).
  Docs impact:
  - If API docs claim `/v1/completions` supports prompt shim, ensure examples include it.
  Definition of Done:
  - Tests cover both endpoints and pass
  - No divergence introduced by auth refactor

### Phase 3 — Feature Flags & Config Parsing

- [x] ID: FLAGS-01
  Title: Standardize boolean parsing to accept common truthy values (`1|true|yes|on`)
  Source(s): [docs/review/feature_flag_gating_report.md](docs/review/feature_flag_gating_report.md); peer AI review “Boolean Parsing Inconsistency”
  Why / Risk:
  - Current `bool()` only treats the literal string `"true"` as true, which is a frequent operational footgun.
  - Several flags are safety-critical (`PROXY_ENABLE_METRICS`, `PROXY_TEST_ENDPOINTS`, `PROXY_ENABLE_RESPONSES`); mis-parsing can silently disable or enable behavior.
  Dependencies: none
  Implementation (code references):
  - Existing code: `bool()` vs `boolishTrue()` inconsistency in config  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/config/index.js#L8-L21>
  - Change summary:
    - Update `bool()` to delegate to `boolishTrue()` semantics (regex `^(1|true|yes|on)$`), keeping call sites unchanged.
    - Do not remove `boolishTrue()`; keep it as the canonical implementation used by `bool()`.
  Acceptance Criteria:
  - AC1: `PROXY_ENABLE_RESPONSES=1` enables the responses router (endpoint exists; not 404).
  - AC2: `PROXY_TEST_ENDPOINTS=1` enables test routes (subject to existing allow-remote and auth rules).
  - AC3: Existing `"true"` / `"false"` behavior remains unchanged.
  Tests (mapped to ACs):
  - For AC1: Extend `tests/integration/responses.flag.int.test.js` with a new test case using `PROXY_ENABLE_RESPONSES="1"` and expecting **not 404**.  
      Existing file: <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/responses.flag.int.test.js#L1-L41>
  - For AC2: Add/extend integration coverage (new or existing file) that sets `PROXY_TEST_ENDPOINTS="1"` and asserts `/__test/echo` is reachable when remote access is allowed and bearer token provided.
  - For AC3: Run the full integration suite (`npm run test:integration`).
  Config / Flags impact:
  - Applies to all boolean flags parsed via `bool()` (e.g., `PROXY_ENABLE_RESPONSES`, `PROXY_ENABLE_METRICS`, `PROXY_USAGE_ALLOW_UNAUTH`, `PROXY_PROTECT_MODELS`, etc.).
  Observability / Logging (if relevant):
  - Consider logging a one-line startup summary of key flags (without secrets) to reduce misconfiguration debugging time.
  Docs impact:
  - Update config reference docs to note truthy values accepted (see FLAGS-02).
  Definition of Done:
  - Integration tests cover at least one “truthy non-true string” per critical flag
  - No regressions in existing test suite

- [x] ID: FLAGS-02
  Title: Document flag parsing semantics and update config matrix/examples
  Source(s): [docs/review/feature_flag_gating_report.md](docs/review/feature_flag_gating_report.md)
  Why / Risk:
  - After changing parsing semantics, documentation must match reality to avoid operator confusion.
  Dependencies: FLAGS-01
  Implementation (code references):
  - Existing code: config keys live in `src/config/index.js`  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/config/index.js#L23-L125>
  - Change summary:
    - Update docs (recommend locations):
      - `docs/reference/config-matrix.md` (if present)
      - `README.md` configuration section
    - Explicitly state accepted truthy values for boolean flags.
  Acceptance Criteria:
  - AC1: Docs list accepted truthy values and include at least one example using `1`.
  - AC2: No docs contradict the new behavior.
  Tests (mapped to ACs):
  - For AC1–AC2: N/A (docs review)
  Config / Flags impact:
  - None (documentation-only)
  Observability / Logging (if relevant):
  - None
  Docs impact:
  - README and config reference docs updated
  Definition of Done:
  - Docs updated and reviewed

### Phase 4 — Codex CLI Hardening

- [x] ID: CLI-01
  Title: Prevent secret env var leakage into spawned Codex processes and block unsafe spawn option overrides
  Source(s): [docs/review/codex_cli_integration_audit_report.md](docs/review/codex_cli_integration_audit_report.md); peer AI review “CLI-03”
  Why / Risk:
  - `spawnCodex` currently forwards `process.env` into the child, including `PROXY_API_KEY` and other secrets.
  - `spawnOptions` is spread after safe defaults, allowing callers to override `stdio`, `env`, and potentially enable `shell`.
  Dependencies: none
  Implementation (code references):
  - Existing code: `spawnCodex` env + spawnOptions behavior  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/services/codex-runner.js#L8-L31>
  - Change summary:
    - Build a sanitized env object:
      - Start with `{...process.env}`
      - Remove denylisted secrets at minimum: `PROXY_API_KEY`, `PROXY_METRICS_TOKEN` (and any other known secret tokens used by the proxy).
      - Preserve `CODEX_*` variables and standard OS vars (PATH, HOME, etc.) by default (denylist strategy).
    - Ensure `spawnOptions` cannot override critical safety properties:
      - Do not allow overriding `env`, `stdio`, `cwd`, or `shell`.
      - Recommended approach: destructure and discard unsafe keys from `spawnOptions`, then explicitly set `shell: false`, `stdio: [...]`, `cwd`, `env` after the spread.
  Acceptance Criteria:
  - AC1: The child process env does **not** contain `PROXY_API_KEY` or `PROXY_METRICS_TOKEN`.
  - AC2: Attempted overrides of `stdio`/`shell` via `spawnOptions` do not change the effective spawn behavior.
  - AC3: Existing functionality continues to work (Codex still spawns, integration tests pass).
  Tests (mapped to ACs):
  - For AC1–AC2: Add a new unit test file `tests/unit/codex-runner.test.js`:
    - Stub `child_process.spawn` to capture the options passed.
    - Set `process.env.PROXY_API_KEY="secret"` and assert it is absent in `options.env`.
    - Pass `spawnOptions: { shell: true, stdio: "inherit" }` and assert `options.shell === false` and `options.stdio` is the expected array.
  - For AC3: `npm run test:unit` and `npm run test:integration`
  Config / Flags impact:
  - None (security hardening only)
  Observability / Logging (if relevant):
  - Do not log full env; if debugging, log only allowlisted keys and redact values.
  Docs impact:
  - If there is a Codex runner doc/runbook, add a short note: proxy secrets are not forwarded to Codex child.
  Definition of Done:
  - Unit tests added and passing
  - No secret leakage remains in spawn path

- [x] ID: CLI-02
  Title: Harden supervisor config quoting to safely encode special characters
  Source(s): [docs/review/codex_cli_integration_audit_report.md](docs/review/codex_cli_integration_audit_report.md); peer AI review “CLI-02”
  Why / Risk:
  - The current `quote()` escapes only `"`, not backslashes or control characters; this can corrupt config values passed to the Codex CLI.
  Dependencies: none
  Implementation (code references):
  - Existing code: `quote()` implementation  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/services/worker/supervisor.js#L9-L13>
  - Change summary:
    - Update `quote()` to escape at least: `"` and `\` and control characters (`\n`, `\r`, `\t`).
    - If strict shell-safety is desired, also escape `$` and backticks as suggested by the peer review (even though spawn is not using a shell by default).
  Acceptance Criteria:
  - AC1: `quote('a"b\\c')` produces a stable quoted string that preserves the original value when parsed.
  - AC2: Newline/tab characters do not break the generated `-c key=value` argument.
  Tests (mapped to ACs):
  - For AC1–AC2: Add unit tests in `tests/unit/worker-supervisor.test.js` or a new small unit test file for quoting.
  Config / Flags impact:
  - None
  Observability / Logging (if relevant):
  - Ensure quoted values are not logged if they may contain secrets.
  Docs impact:
  - None
  Definition of Done:
  - Quote tests added and passing

- [x] ID: CLI-03
  Title: Restart worker on startup readiness timeout (stuck handshake auto-recovery)
  Source(s): [docs/review/codex_cli_integration_audit_report.md](docs/review/codex_cli_integration_audit_report.md); peer AI review “CLI-06”
  Why / Risk:
  - Current supervisor logs readiness timeout but does not kill/restart the worker, leaving the API stuck indefinitely.
  - Auto-restart is required for stability under real-world failure modes.
  Dependencies: none
  Implementation (code references):
  - Existing code: readiness watcher logs but does not restart  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/src/services/worker/supervisor.js#L26-L35>
  - Change summary:
    - In `readyWatcher.catch(...)`, if the worker has not become ready within `WORKER_STARTUP_TIMEOUT_MS`:
      - record a handshake failure (`recordHandshakeFailure()` if appropriate)
      - kill the child process (e.g., `SIGKILL` or `SIGTERM` then `SIGKILL`)
      - rely on existing exit-handling logic to schedule restart.
    - Ensure readiness/liveness state reflects the failure reason so `/healthz` and metrics are accurate.
  Acceptance Criteria:
  - AC1: If the worker does not become ready within the configured timeout, it is terminated and restarted automatically.
  - AC2: Readiness reports an appropriate reason during the failure window (not “ready”).
  - AC3: Restart backoff behavior remains bounded by existing config (`WORKER_RESTART_*`).
  Tests (mapped to ACs):
  - For AC1–AC3: Extend `tests/unit/worker-supervisor.test.js`:
    - Configure a small `WORKER_STARTUP_TIMEOUT_MS` via env/config.
    - Start supervisor with a fake child that never emits ready; assert kill/restart is triggered.
      Existing file: <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/unit/worker-supervisor.test.js#L1-L148>
  Config / Flags impact:
  - `WORKER_STARTUP_TIMEOUT_MS` becomes more operationally meaningful; confirm defaults are sane.
  Observability / Logging (if relevant):
  - Log one structured line on readiness timeout including:
    - timeout value
    - restart attempt count
    - (do not include env/config values that may contain secrets)
  - Metrics: increment/reuse handshake failure counters if present.
  Docs impact:
  - Troubleshooting doc: add “startup timeout triggers restart” so operators know what to expect.
  Definition of Done:
  - Unit tests cover timeout restart behavior
  - No flakiness introduced in supervisor unit tests

### Phase 5 — Final Verification & Docs

- [x] ID: FINAL-01
  Title: Run full CI-equivalent suite, update docs, and produce a release-ready change summary
  Source(s): `docs/review/codex-completions-api_release-checklist.md`; `package.json` scripts
  Why / Risk:
  - Auth and process-spawning changes are high-risk; final verification must be comprehensive.
  Dependencies: AUTH-01..AUTH-04, VALID-01..VALID-02, FLAGS-01..FLAGS-02, CLI-01..CLI-03
  Implementation (code references):
  - Existing code: release checklist doc  
      <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/docs/review/codex-completions-api_release-checklist.md>
  - Change summary:
    - Run: `npm run verify:all`
    - Ensure README and config docs reflect new auth semantics and flag parsing behavior.
  Acceptance Criteria:
  - AC1: All checks pass locally and in CI.
  - AC2: Docs are consistent with behavior (auth, usage allow unauth, boolish flags, worker restart).
  Tests (mapped to ACs):
  - For AC1: commands above
  - For AC2: docs review
  Config / Flags impact:
  - Summarize any behavior changes in release notes (especially flag parsing accepting more truthy values).
  Observability / Logging (if relevant):
  - Confirm no new logs leak tokens or env.
  Docs impact:
  - README + docs/review + config docs
  Definition of Done:
  - CI green
  - Release notes prepared

## Test Matrix

Run commands from `package.json`:
- `npm run verify:all` (CI-equivalent: format check, lint, schema verify, unit+integration+e2e)
- `npm run test:unit` (Vitest)
- `npm run test:integration` (Vitest)
- `npm test` (Playwright)
- `npm run lint`
- `npm run format:check`
- `npm run jsonrpc:verify`

Coverage map (selected):
- Auth enforcement:
  - `tests/integration/server.int.test.js` (chat 401)  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/server.int.test.js>
  - `tests/integration/completions.auth.int.test.js` (legacy completions 401)  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/completions.auth.int.test.js>
  - `tests/integration/responses.auth.int.test.js` (responses 401)  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/responses.auth.int.test.js>
  - `tests/integration/routes.models.int.test.js` (models protect flag)  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/routes.models.int.test.js>
  - **New**: extend `tests/integration/security-hardening.int.test.js` to cover `PROXY_USAGE_ALLOW_UNAUTH` regression.
- Flag gating:
  - `tests/integration/responses.flag.int.test.js`  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/responses.flag.int.test.js>
  - `tests/integration/metrics.int.test.js`  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/integration/metrics.int.test.js>
- Worker supervisor:
  - `tests/unit/worker-supervisor.test.js`  
    <https://github.com/DrJLabs/codex-completions-api/blob/b3e7b3f81ebd8de52492d1aef98ae7cd20218266/tests/unit/worker-supervisor.test.js>

## Suggested PR Plan

1. **PR 1 — Auth split + regression tests**
   - AUTH-01, AUTH-02, AUTH-04 (plus new/updated integration + unit tests)
2. **PR 2 — Models auth refactor**
   - AUTH-03 (small, isolated)
3. **PR 3 — Invalid JSON + middleware ordering**
   - VALID-01 (+ new integration test)
4. **PR 4 — Boolish flags**
   - FLAGS-01, FLAGS-02 (+ integration tests for `=1`)
5. **PR 5 — Codex CLI hardening**
   - CLI-01..CLI-03 (+ new unit tests)
6. **PR 6 — Docs sync**
   - DOCS-01, plus README/config doc updates if not handled in earlier PRs

## Open Questions / Unknowns (Explicit Dependencies)

- No remaining unknowns (as of this revision).
- Verified:
  - The four audit reports are present under `docs/review/` (DOCS-01).
  - `model` is treated as required (see VALID-02).
  - `HEAD /v1/chat/completions` and `HEAD /v1/responses` are authenticated via `requireStrictAuth` (see AUTH-02).
