# 02 — Recommended `AGENTS.md` (copy to repo root as `AGENTS.md`)

This file is intended to be placed at your repository root as **AGENTS.md** so Codex will automatically pick it up.

It encodes **long-horizon execution behavior**: checkpoints, test discipline, and safe refactoring boundaries.

---

## Operating contract

1) **Work in a feature branch**, never directly on `main`/`master`.
2) Make incremental changes. Prefer **small, reviewable commits** over large rewrites.
3) After every meaningful change-set:
   - run the most appropriate test/lint/typecheck commands you can find,
   - record results in `docs/codex-longhorizon/04-PROGRESS.md`,
   - commit with a clear message.
4) Do not introduce new runtime dependencies without an explicit reason and documented tradeoff.
5) Never add secrets to the repo. If a task needs credentials, stop and request human action.
6) Keep network access off unless it is explicitly required.

---

## Repo discovery (first actions)

On start, do the following:

1) Identify stack + entrypoints (language, framework, server entry).
2) Identify test commands and dev scripts:
   - look for `package.json`, `pyproject.toml`, `requirements*.txt`, `Makefile`, `justfile`, `tox.ini`, `noxfile.py`, `.github/workflows/*`, `scripts/*`, `Taskfile.yml`.
3) Write down the discovered commands in `docs/codex-longhorizon/04-PROGRESS.md` under “Tooling”.

---

## Verification discipline

- Prefer a “fast loop” (lint/typecheck/unit tests) after each commit.
- Run a “full loop” (integration/e2e, if present) at least once per major milestone.
- If the repo has CI workflows, align your local verification commands to CI.

If tests are missing or unreliable:
- do not guess; instead:
  1) document the gap,
  2) add minimal smoke tests or harness scripts if that is part of the acceptance criteria,
  3) keep changes narrowly scoped.

---

## Change management rules

### Do
- Remove dead code only after confirming it is unused (imports/grep + entrypoint tracing).
- Prefer additive refactors, then a cleanup pass.
- Add targeted tests when touching behavior-critical components.
- Update docs and examples whenever API surfaces change.

### Don’t
- Don’t rename public APIs casually.
- Don’t reformat the entire repo.
- Don’t do “drive-by” dependency upgrades unless required for security or compatibility.

---

## Documentation rules

- Keep `docs/codex-longhorizon/04-PROGRESS.md` current.
- When adding new docs:
  - prefer `docs/` and link them from an index file.
- When making a behavior change, update:
  - README snippets, examples, or OpenAPI specs (if present),
  - and any integration notes.

---

## Review guidelines (for Codex code review mode, if enabled)

- Flag authentication/authorization gaps.
- Flag unsafe logging (tokens, credentials, PII).
- Flag brittle parsing, unchecked inputs, and missing error handling.
- Flag concurrency hazards and resource leaks.
- Flag “partial migrations” (e.g., some modules updated, others still on legacy patterns).
- Flag missing tests for critical flows.

Treat typos in docs as P2 unless explicitly requested as higher severity.

