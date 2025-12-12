# JSON-RPC Schema Workflow

Source of truth for the app-server transport is **local**: `src/lib/json-rpc/schema.ts`.

## What is canonical

- `src/lib/json-rpc/schema.ts` — hand-maintained TypeScript types + builder helpers used by the proxy at runtime.
- `docs/app-server-migration/app-server-protocol.schema.json` — JSON Schema bundle **generated from** `schema.ts` for reference and validation.
- `npm run jsonrpc:schema` is intentionally a **no-op stub** so contributors cannot accidentally overwrite `schema.ts` from legacy templates.

## When you bump `@openai/codex`

1. Update the dependency in `package.json` and lockfile.
2. Run the test suite (at least `npm run test:unit` + `npm run test:integration`) to catch any protocol drift.
3. If Codex/app-server changed the contract, update `src/lib/json-rpc/schema.ts` accordingly.
4. Regenerate the JSON Schema bundle:
   - `npm run jsonrpc:bundle`
5. Verify the bundle is in sync:
   - `npm run jsonrpc:verify`
   - CI and `npm run verify:all` will fail if this diff is non‑zero.

## Casing / duplication policy

The app-server has historically accepted both camelCase and snake_case field names. To stay compatible with older CLI builds, the builders in `schema.ts` emit **both** for a small set of fields (for example `includeUsage` + `include_usage`, `topP` + `top_p`).

- **Canonical casing is camelCase.**
- Snake_case fields are **back-compat only**; do not add new snake_case variants unless the CLI requires it.
- Unit tests in `tests/unit/json-rpc-schema.test.ts` assert duplicated fields stay identical. If you remove a snake_case alias, update those tests and this doc.

