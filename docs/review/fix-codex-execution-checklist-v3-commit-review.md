## Branch review: `fix/codex-execution-checklist-v3` vs current `main` (657ab65)

Status: branch is divergent and unmerged. Below is a per-commit note on intent and relevance to today’s main.

- 83a54cc docs(review): adds audit/report docs. Relevance: doc-only; safe but optional.
- f4bc6d6 test: isolates responses stream temp files. Relevance: useful hardening; not in main.
- 4960dbe fix(auth): splits strict vs usage auth. Relevance: partially superseded—main already tightened auth; would need re-eval before porting.
- a00aa14 fix(validation): JSON parse errors return JSON. Relevance: main already does this; redundant.
- ecd5b31 fix(validation): require model parameter. Relevance: model-required logic already in main via newer handlers; redundant.
- a0319dc fix(config): accepts 1/yes/on for booleans. Relevance: main still only accepts true/false? If so, potentially useful; needs check before port.
- c25f9ba docs(config): documents boolish parsing. Relevance: only if a0319dc is ported.
- ecfe1be fix(cli): sanitizes child env and clamps spawn options. Relevance: likely still valuable hardening; not on main.
- 49a1a4c fix(worker): escapes config values; restarts on ready timeout. Relevance: probably still useful; not in main.
- 7cd944a chore(lint): removes unused vars in spawnCodex. Relevance: minor cleanup; optional.
- ed398c9 docs: checklist status/runbook updates. Relevance: doc-only; optional.
- cc2ab5f fix: normalizes bearer parsing and handler CORS. Relevance: main already normalizes auth/cors in routes; likely redundant/conflicting with recent fixes.
- 6998082 fix: return JSON for body-parser errors. Relevance: main already handles body-parser errors with JSON+CORS; redundant.
- 73f7e52 test: increases supervisor settle timeout. Relevance: might still reduce flakiness; not in main.
- dd5a6fc docs: formatting for checklist/reports. Relevance: doc-only.
- 820ab95 merge main. Relevance: bookkeeping only.
- d37f087 fix: clamps detached/windowsHide for codex spawn. Relevance: useful hardening; not in main.
- b390de3 fix: start JSON-RPC handshake on worker spawn. Relevance: may reduce race conditions; not in main.
- bf7776c fix: avoid attaching worker after transport destroy. Relevance: safety fix; not in main.
- 6a667ad docs: feature flag report examples. Relevance: doc-only.
- 0d19d05 docs: audit snippet conventions. Relevance: doc-only.
- 4fa966a refactor: simplify spawn option overrides. Relevance: cleanup; check for conflicts with current runner.
- 6f96305 ci: switch to GitHub-hosted runner. Relevance: already on main; redundant.
- 9a8d3d3 fix: record JSON-RPC handshake failures once. Relevance: still useful; not in main.
- d775f8b fix: return JSON for unexpected Express errors. Relevance: main already returns JSON with CORS; redundant.
- c959d83 refactor: shared model_required validation helper. Relevance: main already has model checks; may conflict; likely redundant.
- 9a9fee9 fix: honor PROXY_ENV over NODE_ENV. Relevance: main currently uses NODE_ENV primarily; could be useful if dual envs needed.
- 01ec2c7 chore: smoke/Traefik routing tweaks. Relevance: may be stale vs current compose/labels; needs rebase review.
- 6f219e0 ci: stabilize tool-call smoke scripts. Relevance: potentially useful for CI stability; not in main.
- 54cfb1d fix(auth): avoid src import in container. Relevance: may still apply if ForwardAuth container has that import; needs check vs current auth/server.
- 3db1abb chore: disable nonstream guard in dev stack. Relevance: likely outdated given new title/intercept changes; risky.
- 27cb4c6 fix(chat): default to streaming chat. Relevance: behavior change that may conflict with current defaults; likely unwanted.
- a715422 fix(completions): support app-server backend. Relevance: main may still use proto for completions; this is significant if app-server completions are desired; needs careful port.
- cfb6eeb feat(config): adds PROXY_DEFAULT_STREAM flag. Relevance: not in main; consider only if configurable default stream needed.
- c1864d1 test(security-check): covers NODE_ENV fallback. Relevance: aligns with PROXY_ENV change; useful if that behavior is adopted.
