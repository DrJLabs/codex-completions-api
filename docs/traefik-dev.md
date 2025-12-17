# Traefik / ForwardAuth dev runbook

This proxy relies on a host-level Traefik (file provider) plus a small ForwardAuth service from the dev stack. When traffic stalls or returns 401/500 at the edge, check infra first before debugging app code.

## Topology (dev)
- Traefik listens on `127.0.0.1:443` (file provider only; Docker provider disabled).
- Routers/middlewares/services live at `/etc/traefik/dynamic/codex-dev.yml`.
- ForwardAuth container: `codex-dev-auth-dev-1` → `127.0.0.1:18081` (`/verify`).
- Proxy container: `codex-dev-app-dev-1` → `127.0.0.1:18010` (upstreams Traefik service `codex-dev-api`).

## Quick health checks
- ForwardAuth: `curl -i http://127.0.0.1:18081/verify -H "Authorization: Bearer $PROXY_API_KEY"`
- App direct: `curl -i http://127.0.0.1:18010/healthz`
- Through Traefik (bypassing DNS):  
  `curl -i https://codex-dev.onemainarmy.com/v1/models --resolve codex-dev.onemainarmy.com:443:127.0.0.1 --insecure -H "Authorization: Bearer $PROXY_API_KEY"`
- Traefik logs: `journalctl -u traefik.service -f` (look for forwardauth errors or 4xx/5xx from `codex-dev-api@file`).

## Common breakages
- ForwardAuth port not published: ensure `codex-dev-auth-dev-1` exposes `127.0.0.1:18081->8080`; restart stack if missing.
- Stale containers: `docker rm -f codex-dev-app-dev-1 codex-dev-auth-dev-1 && npm run dev:stack:up`.
- Traefik still using Docker provider: confirm `/etc/traefik/traefik.yml` uses only the file provider.
- Missing or outdated dynamic config: check `/etc/traefik/dynamic/codex-dev.yml` exists and has the `codex-dev-*` routers; restart Traefik after edits (`sudo systemctl restart traefik`).
- Wrong API key: ForwardAuth returns 401; verify `.env.dev` `PROXY_API_KEY` matches the client key.

## Restart commands
- Stack: `npm run dev:stack:down && npm run dev:stack:up`
- Traefik: `sudo systemctl restart traefik`

