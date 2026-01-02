# App-Server Validation and Rollout Checklist

## Purpose

This checklist replaces the legacy proto parity gates. The proxy is app-server only, and proto parity harnesses are retired. Use this as the authoritative validation list before toggling or deploying app-server changes.

## Automated Regression Suites

- [ ] `npm run test:integration` — Execute JSON-RPC integration coverage (baseline, streaming, error gates) against the latest fixtures; capture CLI output or CI link for evidence.
- [ ] `npm test` — Run the end-to-end SSE and API checks to confirm streaming adapters remain stable after fixture refresh.
- [ ] `npm run lint:runbooks` — Lint documentation updates, ensuring links and tables meet rollout formatting rules.

## Transcript Fixture Maintenance (app-server only)

- [ ] Regenerate transcripts via `npm run transcripts:generate`; ensure `test-results/chat-completions/app/` and `manifest.json` carry refreshed `cli_version`, `commit`, and `backend` metadata.
- [ ] Record CLI/App Server versions from transcript metadata (or `manifest.json`) in the rollout notes.

## Manual Verification Steps

- [ ] Execute `npm run smoke:dev` (or staging/prod equivalent) and capture `readyz/livez` responses, CLI availability, and HTTPS routing proofs.
- [ ] Verify `curl -f https://{domain}/readyz` returns readiness within 5 s and note supervisor restart counts before and after the run.
- [ ] Confirm `.codex-api/` (prod) or `.codev/` (dev) remains writable and that health probes stay wired to Traefik for rollback safety.
- [ ] Document stakeholder dry-run agenda covering smoke evidence review and sign-off expectations.

## Rollout Metrics & Observability

- [ ] Track `/readyz` latency, `worker_supervisor.restarts_total`, and streaming error rates pre/post toggle; attach graphs or logs.
- [ ] Log Codex CLI/App Server version identifiers in the rollout package so future fixture updates stay traceable.
- [ ] Note acceptance criteria outcomes and link supporting artifacts (transcripts, manifest, smoke evidence, meeting notes).

## Evidence Index (populate during execution)

| Asset                     | Location                                                                    | Notes                                                           |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Transcript manifest       | `test-results/chat-completions/manifest.json`                               | Includes `generated_at`, `cli_version`, `commit`, scenario count |
| Regression suite logs     | Vitest stdout (`npm run test:integration`) · Playwright report (`npm test`) | Integration + Playwright evidence                               |
| Smoke validation evidence | `./artifacts/smoke/{env}/`                                                  | Curl transcripts and logs                                       |
| Stakeholder review notes  | `docs/app-server-migration/rollout-review.md` (planned)                     | Agenda, attendees, sign-off checkpoints                         |
