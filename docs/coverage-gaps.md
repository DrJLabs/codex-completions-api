# Unit coverage gaps

This captures the latest `npm run coverage:unit` output (vitest v8, `src/**`)
with thresholds from `vitest.config.ts`. Coverage artifacts live under
`coverage/`.

Thresholds: lines 80%, functions 80%, branches 75%, statements 80%.

## Current totals
- Lines: 56.9% (3829/6729), missing 1555 lines to reach 80%.
- Functions: 56.36% (527/935), missing 221 functions to reach 80%.
- Branches: 40.38% (2943/7288), missing 2523 branches to reach 75%.
- Statements: 53.46% (4084/7639), missing 2028 statements to reach 80%.

## Priority targets (lowest line coverage)
| File | L | F | B | S |
| --- | --- | --- | --- | --- |
| `src/lib/bearer.js` | 0.0 | 0.0 | 0.0 | 0.0 |
| `src/middleware/access-log.js` | 4.0 | 33.3 | 0.0 | 4.0 |
| `src/services/codex-exec.js` | 5.0 | 0.0 | 0.0 | 4.8 |
| `src/middleware/auth.js` | 7.7 | 0.0 | 0.0 | 7.1 |
| `src/routes/metrics.js` | 8.0 | 0.0 | 0.0 | 6.9 |
| `src/handlers/responses/stream-adapter.js` | 10.8 | 3.0 | 1.0 | 9.9 |
| `src/handlers/chat/require-model.js` | 14.3 | 100.0 | 12.5 | 18.8 |
| `src/middleware/metrics.js` | 16.7 | 25.0 | 0.0 | 16.7 |
| `src/handlers/chat/stream.js` | 16.9 | 4.9 | 5.0 | 15.2 |
| `src/services/codex-runner.js` | 18.5 | 0.0 | 6.3 | 18.5 |
| `src/routes/usage.js` | 21.4 | 16.7 | 0.0 | 20.0 |
| `src/handlers/chat/capture.js` | 27.5 | 17.6 | 5.0 | 26.4 |
| `src/middleware/rate-limit.js` | 29.0 | 33.3 | 15.2 | 26.5 |
| `src/services/metrics/chat.js` | 30.8 | 7.1 | 0.0 | 29.3 |
| `src/handlers/chat/nonstream.js` | 30.9 | 17.2 | 15.3 | 28.9 |
| `src/routes/chat.js` | 31.3 | 25.0 | 0.0 | 29.4 |
| `src/handlers/responses/capture.js` | 33.3 | 23.1 | 5.0 | 34.3 |
| `src/routes/responses.js` | 33.3 | 25.0 | 0.0 | 30.8 |
| `src/app.js` | 34.9 | 20.0 | 13.0 | 33.3 |
| `src/routes/models.js` | 40.0 | 28.6 | 12.5 | 35.3 |

## Suggested coverage focus
- `src/lib/bearer.js`: unit tests for empty/invalid headers, case-insensitive
  `Bearer` prefix, trimming, and missing headers in `bearerToken()`.
- `src/middleware/auth.js`: exercise `requireStrictAuth`, `requireUsageAuth`,
  and `requireTestAuth` across valid/invalid tokens and loopback gating.
- `src/middleware/access-log.js`: cover happy-path logging and the error
  fallback inside the `finish` handler.
- `src/routes/metrics.js`: cover auth gates (metrics token, allow unauth,
  allow loopback), plus the success path for rendering metrics.
- `src/services/codex-exec.js`: cover prompt validation, spawn error/exit
  failures, timeout path, empty output handling, and output cleanup.
- `src/services/codex-runner.js`: cover env sanitization and lifecycle logging
  around `spawnCodex()`.
- `src/handlers/chat/*` and `src/handlers/responses/*`: cover stream/nonstream
  success/error branches and capture paths.
- `src/routes/*.js`: cover route-level auth, error responses, and the happy
  path for each endpoint.
