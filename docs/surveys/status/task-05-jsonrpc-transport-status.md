# Task 05 – JSON-RPC Transport & Schema
# Source: docs/surveys/TASK_05_JSON_RPC_TRANSPORT_AND_SCHEMA.md

## Work done
- Selected `src/lib/json-rpc/schema.ts` as the canonical source; removed the template renderer and added `jsonrpc:verify` (runs in CI and `verify:all`) to ensure the exported schema stays in sync.
- Refreshed `docs/app-server-migration/app-server-protocol.schema.json` and tightened builders with `normalizeInputItems` to avoid empty item arrays.
- Added schema/transport unit coverage against the fake JSON-RPC worker to validate notifications, ids, and parsing logic.
- Documented the canonical schema maintenance loop in `docs/app-server-migration/jsonrpc-schema-workflow.md` and updated the migration guide/backlog to reference `jsonrpc:bundle` + `jsonrpc:verify`.
- Clarified camelCase vs snake_case back‑compat policy; builders continue emitting paired fields with unit tests asserting alignment.
- Expanded `mapTransportError` unit coverage and regenerated the schema bundle after bumping the Codex CLI pin to 0.71.0.

## Gaps
- CamelCase/snake_case duplicates remain for older CLI compatibility; remove only when upstream no longer accepts snake_case.
- Future CLI bumps still require a manual review of `schema.ts` for contract drift (workflow now documented and CI‑verified).

## Plan / Acceptance Criteria & Tests
- AC1: Document the canonical schema workflow (complete). Test layer: doc lint/link check after adding instructions and linking to `jsonrpc:verify`.
- AC2: Normalize or explicitly deprecate duplicate fields/casing in builders and schema (complete). Test layer: unit assertions that paired fields remain aligned.
- AC3: Extend tests to cover transport error mapping and idempotent bundle generation (complete). Test layer: unit + CI `jsonrpc:verify`.
