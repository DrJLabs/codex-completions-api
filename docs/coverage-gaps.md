# Unit coverage gaps

This captures the latest `npm run coverage:unit` output (vitest v8, `src/**`)
with thresholds from `vitest.config.ts`. Coverage artifacts live under
`coverage/`.

Thresholds: lines 80%, functions 80%, branches 75%, statements 80%.

## Current totals
- Lines: 63.64% (4282/6728), missing 1101 lines to reach 80%.
- Functions: 65.34% (611/935), missing 137 functions to reach 80%.
- Branches: 46.52% (3390/7287), missing 2076 branches to reach 75%.
- Statements: 59.89% (4575/7638), missing 1536 statements to reach 80%.

## Priority targets (lowest line coverage)
| File | L | F | B | S |
| --- | --- | --- | --- | --- |
| `src/handlers/chat/stream.js` | 16.93 | 4.9 | 4.95 | 15.21 |
| `src/handlers/chat/capture.js` | 27.47 | 17.64 | 5.04 | 26.41 |
| `src/app.js` | 28.2 | 11.11 | 4.47 | 26.82 |
| `src/handlers/chat/nonstream.js` | 30.9 | 17.24 | 15.33 | 28.88 |
| `src/handlers/responses/capture.js` | 33.33 | 23.07 | 5.0 | 34.28 |
| `src/handlers/responses/nonstream.js` | 46.66 | 40.0 | 14.39 | 45.04 |
| `src/lib/tools/xml.js` | 50.0 | 80.0 | 55.17 | 48.0 |
| `src/services/transport/child-adapter.js` | 51.82 | 45.16 | 32.8 | 45.5 |
| `src/handlers/chat/shared.js` | 55.08 | 71.42 | 39.31 | 52.38 |
| `src/lib/capture/sanitize.js` | 57.14 | 40.0 | 42.16 | 49.43 |
| `src/services/sse.js` | 59.3 | 50.0 | 36.36 | 54.0 |
| `src/services/metrics/index.js` | 67.82 | 64.0 | 30.98 | 62.12 |
| `src/lib/errors.js` | 70.83 | 42.85 | 63.82 | 70.83 |
| `src/services/transport/index.js` | 71.38 | 64.1 | 56.81 | 67.85 |
| `src/routes/health.js` | 71.42 | 60.0 | 53.48 | 71.42 |
| `src/services/worker/supervisor.js` | 74.4 | 75.6 | 51.23 | 71.86 |
| `src/handlers/responses/shared.js` | 75.37 | 76.92 | 56.09 | 69.82 |
| `src/handlers/chat/request.js` | 76.03 | 95.83 | 61.03 | 71.07 |
| `src/handlers/responses/stream-adapter.js` | 78.3 | 84.84 | 59.5 | 75.85 |
| `src/handlers/responses/ingress-logging.js` | 78.94 | 75.0 | 63.69 | 72.72 |

## Suggested coverage focus
- `src/handlers/chat/stream.js` + `src/handlers/chat/nonstream.js`: cover
  stream/nonstream success/error branches, tools handling, and capture paths.
- `src/handlers/chat/capture.js` + `src/handlers/responses/capture.js`: cover
  capture error branches, partial output persistence, and edge cases.
- `src/app.js`: cover trust proxy handling, middleware ordering, and guardrails.
- `src/handlers/responses/nonstream.js` + `src/handlers/responses/shared.js`:
  cover nonstream error mapping and shared response shape helpers.
- `src/handlers/responses/stream-adapter.js`: cover remaining fallbacks and
  event summary logging branches.
- `src/services/transport/child-adapter.js` + `src/services/transport/index.js`:
  cover teardown, retry, and error handling paths.
- `src/services/sse.js` + `src/services/metrics/index.js`: cover streaming helper
  branches and metrics normalization boundaries.
- `src/lib/tools/xml.js` + `src/lib/capture/sanitize.js`: cover parsing/sanitize
  branches and malformed inputs.

## Plan overview
### Goals
- Maintain existing global thresholds (lines 80%, functions 80%, branches 75%,
  statements 80%) without lowering the bar.
- Build deterministic unit tests for `src/**` that cover error paths, branch
  decisions, and boundary conditions.
- Keep tests fast and hermetic (no network, no real Codex CLI) by stubbing
  external dependencies.

### Scope
- In scope: unit coverage for `src/**` (vitest v8, `npm run coverage:unit`).
- Out of scope: integration/e2e coverage (tracked elsewhere) and coverage for
  `tests/**` or `dist/**` (excluded by config).

### Definition of done
- `npm run coverage:unit` passes thresholds.
- All new unit tests are deterministic and do not depend on timing races.
- Any new helpers for testing are documented and reused across suites.

## Workstreams and milestones
### Phase 1: quick wins (low complexity, high ROI)
- `src/lib/bearer.js` (0% coverage).
- `src/middleware/auth.js`.
- `src/middleware/access-log.js`.
- `src/routes/metrics.js` (auth gates and render path).
- `src/middleware/metrics.js`.

### Phase 2: core services (controlled mocking)
- `src/services/codex-exec.js` (success path + error/timeout cleanup).
- `src/services/codex-runner.js` (env sanitization, spawn options, lifecycle).
- `src/services/metrics/chat.js` (pure metrics helpers).
- `src/middleware/rate-limit.js` (keying + boundary behavior).

### Phase 3: handlers (branch-heavy paths)
- `src/handlers/chat/stream.js` and `src/handlers/chat/nonstream.js`.
- `src/handlers/chat/capture.js` and `src/handlers/chat/require-model.js`.
- `src/handlers/responses/stream-adapter.js` and `src/handlers/responses/capture.js`.

### Phase 4: routes and app wiring
- `src/routes/chat.js`, `src/routes/responses.js`, `src/routes/usage.js`,
  `src/routes/models.js`.
- `src/app.js` (trust proxy, middleware ordering, test router guards).

## Test design checklist
- Use `vi.spyOn` or `vi.mock` to isolate dependencies (Codex spawn, FS, timers).
- Prefer table-driven tests for branchy logic (auth gates, flags, env values).
- Validate error responses (status, shape, headers) and happy paths.
- For streaming paths, assert chunk ordering and proper termination.
- Ensure cleanup code runs (timeouts cleared, temp files removed).

## Tracking template
- Phase 1: owner=__ status=todo target_files=__ notes=__
- Phase 2: owner=__ status=todo target_files=__ notes=__
- Phase 3: owner=__ status=todo target_files=__ notes=__
- Phase 4: owner=__ status=todo target_files=__ notes=__

## How to verify
- Targeted: `npm run test:unit -- tests/unit/<new-spec>.js`
- Full unit suite: `npm run test:unit`
- Coverage gate: `npm run coverage:unit` (must pass thresholds)
