---
title: Modernize formatting, linting, and test automation (backlog)
date: 2025-09-17
owner: QA/Dev
status: open
priority: P2
source: backlog
labels: [tooling, testing, ci]
---

Capture the outstanding modernization work noted in the latest testing/tooling review so we can schedule it post-release:

- **Prettier housekeeping**: Trim the temporary entries in `.prettierignore` that currently hide real docs/tests. Once restored, run `npm run format -- --write` (or the project alias) and add a CI guard (`npm run format:check`) so regressions fail pipelines when local hooks are skipped.
- **ESLint pre-push cache**: Update the Husky pre-push hook to call `npm run lint -- --cache` so repeat pushes lint only changed files, matching ESLint CLI guidance.
- **Vitest CI mode**: Ensure unit and integration CI jobs invoke `vitest run` (non-watch) instead of the default watcher so jobs finish deterministically in headless runners.
- **Vitest rule coverage**: Evaluate enabling `@vitest/eslint-plugin` for the test suites to catch Vitest-specific pitfalls that generic ESLint rulesets miss.
- **Playwright best practices**: Revisit `playwright.config.ts` against the upstream best-practices guide—specifically network mocking, sharding via `--shard`, and limiting browser downloads in CI—to keep E2E runs lean.

Outcome: CI/tooling stays fast, deterministic, and aligned with current upstream recommendations.
