---
title: Distributed Rate Limiting – Design & Test Plan
date: 2025-09-12
owner: Platform/QA
status: open (deferred)
priority: P3
source: qa
labels: [rate-limit, distributed, design]
---

## Summary

App-level rate limiting (in-memory token bucket) is now implemented as defense-in-depth. For multi-instance deployments, design and validate a distributed rate limiting strategy (edge/CDN or Redis-backed) to enforce global limits across replicas.

## Proposed Approaches

- Edge/CDN (preferred): Cloudflare/Traefik rate limits keyed by API key + route; include burst and sustained limits; keep app limiter as backstop.
- Redis-backed token bucket: Shared counters with TTL by (api_key, route) and (ip, route) for defense-in-depth behind the edge.

## Test Plan

- Simulate N replicas locally with docker-compose or separate ports; drive concurrent load and verify global 429 behavior.
- Validate headers: `Retry-After` propagation; consistent error envelope.
- Negative tests: ensure non-protected routes unaffected; confirm limits reset with window.

## Deliverables

- ADR documenting chosen approach and limits.
- Automated perf/regression tests (smoke) exercising distributed limits.
- Operational runbook (dashboards/alerts; tuning guidance).

## Dependencies

- Access to edge configuration (Cloudflare/Traefik) or Redis cluster.
