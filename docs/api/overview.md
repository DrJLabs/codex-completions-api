# API Overview

This proxy exposes an OpenAI-compatible API surface intended to be a drop-in for clients.

## Endpoints

| Endpoint | Methods | Auth | Notes |
| --- | --- | --- | --- |
| `/healthz` | `GET` | none | Health + backend snapshots |
| `/readyz` | `GET` | none | App-server readiness (503 until ready) |
| `/livez` | `GET` | none | App-server liveness (503 if unhealthy) |
| `/v1/models` | `GET`, `HEAD`, `OPTIONS` | optional | Public unless `PROXY_PROTECT_MODELS=true` |
| `/v1/chat/completions` | `POST`, `HEAD` | bearer | Streaming (SSE) and non-stream |
| `/v1/responses` | `POST`, `HEAD` | bearer | Enabled by default (`PROXY_ENABLE_RESPONSES=true`) |
| `/v1/usage` | `GET` | bearer* | *Unless `PROXY_USAGE_ALLOW_UNAUTH=true` |
| `/v1/usage/raw` | `GET` | bearer* | *Unless `PROXY_USAGE_ALLOW_UNAUTH=true` |

## Authentication

Set a key and pass it as a bearer token:

```bash
KEY="<your-key>"
```

## Runnable curl examples

Models:

```bash
curl -s http://127.0.0.1:18000/v1/models | jq .
```

Chat completions (non-stream):

```bash
curl -s http://127.0.0.1:18000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"codev-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq .
```

Chat completions (stream):

```bash
curl -N http://127.0.0.1:18000/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"codev-5","stream":true,"messages":[{"role":"user","content":"Say hello."}]}' 
```

Responses (non-stream):

```bash
curl -s http://127.0.0.1:18000/v1/responses \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"codev-5","input":"Say hello.","stream":false}' | jq .
```

## Canonical contract

For byte-level envelope expectations (streaming order, `[DONE]`, typed responses events, etc.), see `../openai-endpoint-golden-parity.md`.
