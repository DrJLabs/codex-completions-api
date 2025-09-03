# Private AI Model API Proxy over Tailscale

Goal: remove the API proxy from the public internet and make it reachable only to authenticated devices in your Tailscale tailnet, with least‑privilege access controls and no exposed public ports.

Audience: internal services and teammates who can run the Tailscale client. If you must serve external customers or browser‑only clients, keep a zero‑trust public edge separately (e.g., Cloudflare Access + mTLS) and do not reuse that path for ops traffic.

## Patterns

- Tailscale sidecar (recommended for Docker): Give the proxy a tailnet identity by sharing a network namespace with a `tailscale` container. No host ports published; access via MagicDNS and tailnet ACLs.
- Tailscale Serve (host): Run `tailscaled` on the host and bind the proxy to localhost; expose to the tailnet via `tailscale serve`. Great for single‑host setups.
- Userspace proxy (optional): Route the app’s egress through Tailscale SOCKS5/HTTP proxy in serverless/locked‑down environments. Not required for typical Docker hosts.

## Prerequisites

- Tailnet admin access to create an Auth key (prefer tagged, reusable, and/or ephemeral).
- A tag for this service, e.g., `tag:ai-proxy` with appropriate ACLs.
- MagicDNS enabled (recommended) for stable `hostname.ts.net` names.

References (doc‑first):
- Tailscale Docker setup and Compose patterns: https://tailscale.com/kb/1282/docker and https://tailscale.com/kb/1453/quick-guide-docker
- Tailscale Serve reference and examples: https://tailscale.com/kb/1312/serve and https://tailscale.com/kb/1242/tailscale-serve
- Serve config file (`TS_SERVE_CONFIG`): https://tailscale.com/kb/1282/docker

---

## Option A — Docker sidecar (per‑service tailnet IP)

This pattern keeps the API fully private. The API process listens only inside the container; the `tailscale` sidecar joins the tailnet and makes the service reachable to allowed users/devices. No public ports are published.

docker-compose.yml
```
services:
  ai-proxy:
    image: yourorg/codex-completions-proxy:latest
    container_name: ai-proxy
    # Listen only inside the container
    environment:
      - PORT=8080
      - PROVIDER_BASE_URL=${PROVIDER_BASE_URL}
      - PROVIDER_API_KEY=${PROVIDER_API_KEY}
    expose:
      - "8080"  # visible to the tailscale sidecar via shared netns
    # Share network namespace with tailscale
    network_mode: service:tailscale
    restart: unless-stopped

  tailscale:
    image: tailscale/tailscale:stable
    container_name: ai-proxy-ts
    hostname: ai-proxy
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}                # do NOT commit; load from env/secret store
      - TS_EXTRA_ARGS=--advertise-tags=tag:ai-proxy
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_ACCEPT_DNS=false                     # docker host handles DNS
      # Optional health + metrics (Tailscale 1.78+)
      - TS_ENABLE_HEALTH_CHECK=true
      - TS_ENABLE_METRICS=true
      - TS_LOCAL_ADDR_PORT=[::]:9002
    volumes:
      - ./state/tailscale:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
      - NET_RAW
    # (Key bit) Give tailscale the network namespace that ai-proxy will use
    network_mode: bridge
    # Start tailscale first; compose will wire netns via network_mode: service:tailscale
    restart: unless-stopped
```

How it works
- The `tailscale` container joins your tailnet and becomes `ai-proxy.ts.net` (MagicDNS).
- `ai-proxy` shares the network namespace (`network_mode: service:tailscale`), so it’s reachable only via the tailnet IP/hostname. No host ports are published.

Login & run
```
docker compose up -d
# First run may require auth if key is missing/invalid.
docker logs -f ai-proxy-ts   # shows login URL if not using TS_AUTHKEY
```

Test from a tailnet device
```
curl -sS https://ai-proxy.ts.net/healthz   # your app’s health endpoint (example)
curl -sS -H "Authorization: Bearer <token>" \
  https://ai-proxy.ts.net/v1/completions -d '{"model":"gpt-4o-mini","input":"ping"}'
```

ACL example (tailnet policy)
```json
{
  "acls": [
    { "action": "accept", "src": ["group:devs", "tag:ci"], "dst": ["tag:ai-proxy:443", "tag:ai-proxy:80"] }
  ],
  "tagOwners": {
    "tag:ai-proxy": ["group:infra-admins"]
  }
}
```

Notes
- Prefer reusable, tagged Auth keys; for disposable nodes, append `?ephemeral=true` to the key.
- Health/metrics endpoints are local to the container (`TS_LOCAL_ADDR_PORT`); scrape from sidecars/host if needed.

---

## Option B — Host `tailscaled` + Tailscale Serve (no container changes)

Bind your API to localhost and expose it privately with `tailscale serve`. Tailscale handles certificates and user identity headers inside the tailnet.

1) Install and bring up Tailscale on the host, enable MagicDNS.
```
sudo tailscale up --accept-dns=true --hostname=$(hostname)
```

2) Start your API bound to localhost only (example: port 8080).
```
PORT=8080 node server.js  # or your process manager
```

3) Expose it to the tailnet over HTTPS with Serve.
```
sudo tailscale serve 8080
# Accessible at: https://<host>.ts.net
```

4) Verify
```
curl -L https://<host>.ts.net
tailscale serve status
```

Serve config file (optional, Docker‑friendly)
```
{
  "TCP": {},
  "Web": {
    "/": { "Handlers": { "Proxy": "http://127.0.0.1:8080" } }
  }
}
```
Use with the container image via `TS_SERVE_CONFIG` (see Docker docs cited above).

Identity headers
When proxying HTTP, `tailscale serve` injects identity headers (e.g., `Tailscale-User-Login`) so backends can recognize the caller. Only valid for tailnet traffic and not for tagged devices; keep backends bound to `localhost` for trust.

---

## Security & hygiene

- Secrets: never commit `TS_AUTHKEY` or upstream provider API keys. Load via environment or secret manager. Provide a `.env.example` template only.
- Ports: don’t publish host ports when using sidecars. If you must bind, firewall to `tailscale0` only.
  - ufw: `ufw allow in on tailscale0 to any port 8080` then deny others
  - iptables: allow on `-i tailscale0` and drop default for the port
- ACLs: lock down access to `tag:ai-proxy` and specific ports only (80/443 when using Serve; custom TCP if using raw `--tcp`).
- Posture: enforce device posture/MFA in tailnet settings for sensitive access.
- Egress allow‑list: restrict outbound from the proxy to approved AI providers/domains.
- Rate limiting/quotas: enforce per‑caller limits to protect from abuse/costs.

## Minimal .env example (do not commit real secrets)
```
# Tailscale (sidecar pattern)
TS_AUTHKEY=
TS_EXTRA_ARGS=--advertise-tags=tag:ai-proxy

# Your proxy
PROVIDER_BASE_URL=
PROVIDER_API_KEY=
PORT=8080
```

## Smoke checks

1) Container up and in tailnet
```
docker compose ps
tailscale status | grep ai-proxy
```

2) Health
```
curl -f https://ai-proxy.ts.net/healthz
```

3) API
```
curl -sS -H "Authorization: Bearer <token>" \
  https://ai-proxy.ts.net/v1/completions \
  -d '{"model":"gpt-4o-mini","input":"ping"}' | jq .
```

---

## Troubleshooting

- Auth key rejected: ensure it’s valid for containers and carries the `tag:ai-proxy` tag if required.
- MagicDNS resolution fails: confirm MagicDNS is enabled; otherwise use `tailscale ip -4 ai-proxy` and connect via `https://100.x.y.z`.
- No traffic reaching app: check `tailscale serve status`, confirm the Proxy mapping, and verify the app binds to 127.0.0.1:PORT in Option B or that the sidecar shares netns in Option A.
- Health 503 in container: for 1.78+ set `TS_ENABLE_HEALTH_CHECK=true` and confirm at `http://127.0.0.1:9002/healthz` from inside the netns.

---

## Why this is safer

- No public DNS or open inbound ports; access is restricted to authenticated tailnet devices.
- Per‑user identity and audit via Tailscale; optional auth at the app layer.
- Works for HTTP and non‑HTTP protocols; no additional reverse proxy required.

