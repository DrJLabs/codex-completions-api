# Task 05 – JSON-RPC Transport & Schema
# Source: docs/surveys/TASK_05_JSON_RPC_TRANSPORT_AND_SCHEMA.md

## Work done
- Selected `src/lib/json-rpc/schema.ts` as the canonical source; removed the template renderer and added `jsonrpc:verify` (runs in CI and `verify:all`) to ensure the exported schema stays in sync.
- Refreshed `docs/app-server-migration/app-server-protocol.schema.json` and tightened builders with `normalizeInputItems` to avoid empty item arrays.
- Added schema/transport unit coverage against the fake JSON-RPC worker to validate notifications, ids, and parsing logic.

## Gaps
- CamelCase/snake_case duplication and unused/ignored fields (e.g., choice count, requestedModel) remain undocumented and could drift.
- Schema workflow is not yet documented for contributors (when to rerun bundle, how to verify changes).
- No automated guard that regenerating the bundle is idempotent in CI beyond the diff check; transport error mapping coverage is still thin.

## Plan / Acceptance Criteria & Tests
- AC1: Document the canonical schema workflow (who regenerates, when) in `docs/app-server-migration/` and README tooling section. Test layer: doc lint/link check after adding instructions and linking to `jsonrpc:verify`.
- AC2: Normalize or explicitly deprecate duplicate fields/casing in builders and schema; remove unused knobs or assert they are ignored with tests. Test layer: unit assertions that builders reject stray fields and keep a single canonical casing.
- AC3: Extend tests to cover transport error mapping and idempotent bundle generation (run `jsonrpc:bundle` + `git diff --exit-code` in CI). Test layer: CI or unit harness spawning bundle generation and asserting no diff; add error mapping tests in transport unit/integration.
