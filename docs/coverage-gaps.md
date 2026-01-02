# Unit coverage gaps

This captures the latest `npm run coverage:unit` output (vitest v8, `src/**`)
with thresholds from `vitest.config.ts`. Coverage artifacts live under
`coverage/`.

Thresholds: lines 80%, functions 80%, branches 75%, statements 80%.

## Current totals
- Lines: 57.96% (3900/6728), missing 1483 lines to reach 80%.
- Functions: 57.96% (542/935), missing 206 functions to reach 80%.
- Branches: 41.16% (3000/7287), missing 2466 branches to reach 75%.
- Statements: 54.49% (4162/7638), missing 1949 statements to reach 80%.

## Priority targets (lowest line coverage)
| File | L | F | B | S |
| --- | --- | --- | --- | --- |
| `src/services/codex-exec.js` | 5.0 | 0.0 | 0.0 | 4.8 |
| `src/handlers/responses/stream-adapter.js` | 10.8 | 3.0 | 1.0 | 9.9 |
| `src/handlers/chat/require-model.js` | 14.3 | 100.0 | 12.5 | 18.8 |
| `src/handlers/chat/stream.js` | 16.9 | 4.9 | 5.0 | 15.2 |
| `src/services/codex-runner.js` | 18.5 | 0.0 | 6.3 | 18.5 |
| `src/routes/usage.js` | 21.4 | 16.7 | 0.0 | 20.0 |
| `src/handlers/chat/capture.js` | 27.5 | 17.6 | 5.0 | 26.4 |
| `src/app.js` | 28.2 | 11.1 | 4.5 | 26.8 |
| `src/middleware/rate-limit.js` | 29.0 | 33.3 | 15.2 | 26.5 |
| `src/services/metrics/chat.js` | 30.8 | 7.1 | 0.0 | 29.3 |
| `src/handlers/chat/nonstream.js` | 30.9 | 17.2 | 15.3 | 28.9 |
| `src/routes/chat.js` | 31.3 | 25.0 | 0.0 | 29.4 |
| `src/handlers/responses/capture.js` | 33.3 | 23.1 | 5.0 | 34.3 |
| `src/routes/responses.js` | 33.3 | 25.0 | 0.0 | 30.8 |
| `src/routes/models.js` | 40.0 | 28.6 | 12.5 | 35.3 |
| `src/handlers/responses/nonstream.js` | 46.7 | 40.0 | 14.4 | 45.0 |
| `src/lib/tools/xml.js` | 50.0 | 80.0 | 55.2 | 48.0 |
| `src/services/transport/child-adapter.js` | 51.8 | 45.2 | 32.8 | 45.5 |
| `src/handlers/chat/shared.js` | 55.1 | 71.4 | 39.3 | 52.4 |
| `src/lib/capture/sanitize.js` | 57.1 | 40.0 | 42.2 | 49.4 |

## Suggested coverage focus
- `src/services/codex-exec.js`: cover prompt validation, spawn error/exit
  failures, timeout path, empty output handling, and output cleanup.
- `src/services/codex-runner.js`: cover env sanitization and lifecycle logging
  around `spawnCodex()`.
- `src/handlers/chat/stream.js` + `src/handlers/chat/nonstream.js`: cover
  stream/nonstream success/error branches, tools handling, and capture paths.
- `src/handlers/responses/stream-adapter.js` + `src/handlers/responses/capture.js`:
  cover stream adapter fallbacks and capture error branches.
- `src/routes/*`: cover auth, error responses, and success paths for chat,
  responses, models, and usage routes.
- `src/middleware/rate-limit.js`: cover keying, window enforcement, and disabled
  settings.
- `src/services/metrics/chat.js`: cover metric labels, normalization, and
  boundary conditions.
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
