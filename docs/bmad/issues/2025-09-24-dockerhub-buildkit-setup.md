---
title: Follow-up — Configure Docker Hub auth for BuildKit
status: open
owner: infra-devops-platform
priority: P2
labels: [ops, docker, buildkit]
---

## Context

`npm run dev:stack:up` now sets `DOCKER_BUILDKIT=0` so the dev stack can build without hitting registry authentication errors. This is a temporary measure; we should restore BuildKit once Docker Hub credentials are in place.

## Why this matters

- BuildKit improves build speed and caching; disabling it is a regression.
- Future Dockerfiles might rely on BuildKit-only features.
- Manual override is brittle and easy to forget.

## Tasks

- [ ] Add Docker Hub credentials (or token) under `~/.docker/config.json` for the CI/dev user.
- [ ] Verify `docker login` works and `docker pull docker/dockerfile:1` succeeds.
- [ ] Re-enable BuildKit for `npm run dev:stack:up` (remove DOCKER_BUILDKIT override) and confirm compose build succeeds.
- [ ] Update docs (README or dev setup guide) with credential instructions.

## Notes

- Original failure: `401 Unauthorized` while resolving `docker.io/docker/dockerfile:1` when BuildKit attempted to download the front-end image.
- Change applied: `package.json` script now prefixes `DOCKER_BUILDKIT=0`.
- Timeline: prefer to resolve before next sprint so devs benefit from BuildKit caching.
