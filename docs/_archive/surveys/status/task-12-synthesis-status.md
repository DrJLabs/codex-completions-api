# Task 12 – Synthesis & Remediation Roadmap
# Source: docs/surveys/task-12-synthesis-and-remediation-roadmap.md

## Work done
- P0 backlog items largely implemented: usage/test routes now auth’d; `/v1/responses` rate-limited; prod fail-fast via `assertSecureConfig`; explicit host binding; responses feature flag added.
- P1 progress: canonical JSON-RPC schema workflow enforced via `jsonrpc:verify` (CI + `verify:all`); doc indexes improved; CI now uploads artifacts and enforces clean workspace.
- P2 progress: streaming/worker metrics expanded; optional OTEL tracing added; legacy installer archived in favor of Compose; responses readiness guard landed.
- Long-horizon backlog/progress docs added (`docs/codex-longhorizon/03-MASTER-EXECUTION-PLAN.md`, `04-PROGRESS.md`).

## Gaps
- Remaining P1: doc drift resolution (canonical index with statuses), proto/ForwardAuth policy decisions, coverage gating/test tagging.
- Remaining P2: upstream metrics/alerts/runbooks, deployment matrix clarity, and final doc alignment.

## Plan / Acceptance Criteria & Tests
- AC1 (P1): Finish doc IA/drift fixes and policy decisions (proto, ForwardAuth, responses flag defaults). Test: updated docs passing link lint; CI references only canonical endpoints/policies.
- AC2 (P1): Add coverage/tagging strategy and expand targeted tests per backlog (models protection, stream metrics). Test: CI job for coverage or documented opt-out; new tests merged.
- AC3 (P2): Add upstream/ops metrics + runbooks and deployment matrix; include responses readiness guard. Test: integration proving readiness gate, metrics presence, and doc/runbook lint in CI.
