# Proto Deprecation Design

## Summary
Remove the legacy `codex proto` backend and the `/v1/completions` endpoint. The proxy becomes app-server (JSON-RPC) only, with `PROXY_USE_APP_SERVER=false` acting as a hard disable instead of a proto fallback. All deterministic proto shims, parity harnesses, and proto transcript capture paths are removed. The deterministic JSON-RPC shim remains the only test/CI backend. Docs are updated to reflect the removal of proto mode and `/v1/completions`.

## Goals
- Eliminate proto runtime and test dependencies without breaking app-server behavior.
- Reduce backend branching to a single supported transport (JSON-RPC).
- Remove `/v1/completions` to align with current client expectations and reduce surface area.
- Keep a safe, explicit disable switch (`PROXY_USE_APP_SERVER=false`) that returns 503.

## Non-goals
- No changes to `/v1/chat/completions` or `/v1/responses` external schemas.
- No changes to auth, rate limiting, or tracing semantics beyond removing proto-only references.
- No replacement for `/v1/completions` beyond requiring migration.

## Current State
The proxy supports two backend modes: app-server JSON-RPC and legacy proto. The proto path spawns a per-request `codex proto` process, has its own idle timeout and debug flags, and still has shims and parity tests in CI. Documentation and runbooks reference the proto fallback as a viable option, and transcript tools generate app + proto pairs for parity checks. There is still a `/v1/completions` route and rate-limit guard in place even though the preferred client traffic is chat/responses.

## Proposed Changes
1) **Backend mode reduction**
- `PROXY_USE_APP_SERVER=true` selects the JSON-RPC worker path.
- `PROXY_USE_APP_SERVER=false` returns `app_server_disabled` (503) instead of falling back to proto.
- Remove proto-specific defaults and flags (`PROXY_PROTO_IDLE_MS`, `PROXY_DEBUG_PROTO`).

2) **Route surface cleanup**
- Remove `/v1/completions` routes and rate-limit coverage.
- Keep `/v1/chat/completions` and `/v1/responses` unchanged.

3) **Test and tooling cleanup**
- Remove deterministic proto shims and parity fixtures.
- Update integration/e2e tests to use JSON-RPC shim modes for long streams, hangs, provider usage, and token-count-only cases.
- Remove proto transcript generation and parity comparisons.

4) **Documentation updates**
- Remove references to proto mode, proto shims, and proto idle timeout flags.
- Update runbooks and migration docs to reflect app-server only.

## Data Flow (App-Server Only)
Request -> Express route -> handler -> JSON-RPC adapter -> app-server worker -> SSE/non-stream output. No alternate protocol path exists. When app-server is disabled, handlers respond with 503 immediately. Worker readiness gating and tracing remain unchanged, but no proto-specific logging gates are required for correctness.

## Error Handling
- `PROXY_USE_APP_SERVER=false` yields `503` with `app_server_disabled`.
- Worker readiness and handshake failures remain on the existing readiness path.
- Idle timeouts use `PROXY_IDLE_TIMEOUT_MS` only.

## Testing Strategy
- Unit and integration suites run against `scripts/fake-codex-jsonrpc.js` exclusively.
- Replace proto-only fixtures with JSON-RPC shim modes that simulate the same behavioral edges.
- Keep Playwright e2e coverage intact, but remove any proto parity expectations.

## Rollout & Risk
- Rollout is a straight removal of proto paths and `/v1/completions`.
- Risk is primarily in clients still calling `/v1/completions` or relying on proto fallback. Mitigation: clear removal in docs and explicit 503 when app-server disabled.
- The change reduces complexity and avoids maintaining protocol parity with deprecated CLI behavior.

## Open Questions
- None. All required compatibility is within app-server paths and JSON-RPC shim coverage.
