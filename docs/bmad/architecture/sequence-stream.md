---
title: Sequence Diagram — Streaming Chat (/v1/chat/completions?stream=true)
status: draft
version: v1
updated: 2025-09-13
---

This diagram shows the streaming (SSE) flow only. Non‑stream is intentionally omitted per request.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant P as Express Proxy
  participant RL as RateLimit mw
  participant H as Chat Stream Handler
  participant SSE as SSE Utils
  participant CR as Codex Runner
  participant B as Codex CLI (proto)
  participant DL as Dev Logging

  C->>P: POST /v1/chat/completions (stream=true)\nAuthorization: Bearer …\nmessages[]
  activate P
  P->>RL: check window/max (optional)
  RL-->>P: ok | 429
  P->>H: route to handler (auth/model validation)
  H->>SSE: set headers (text/event-stream, no-transform)
  H->>H: concurrency guard (PROXY_SSE_MAX_CONCURRENCY)
  H->>CR: build args (sandbox, model, provider, effort)
  CR->>B: spawn "codex proto …" (cwd=PROXY_CODEX_WORKDIR, CODEX_HOME)
  H-->>C: SSE role-first delta (assistant)
  loop child output lines
    B-->>H: JSON line (agent_message_delta|agent_message|token_count|task_complete)
    H->>DL: appendProtoEvent (DEV)
    alt delta/message
      H-->>C: SSE chunk {delta: {content}}
      H->>H: parse <use_tool> blocks; track lastToolEnd
      alt STOP_AFTER_TOOLS | TOOL_BLOCK_MAX
        H->>SSE: finish [DONE]
        H-xB: SIGTERM
        break
      else SUPPRESS_TAIL AFTER_TOOLS
        H->>H: suppress narrative after last tool
      end
    else token_count
      H->>H: update pt/ct estimates
    end
    par keepalive
      SSE-->>C: ": keepalive <ts>" (every PROXY_SSE_KEEPALIVE_MS)
    end
  end
  B-->>H: task_complete
  H->>DL: appendUsage (prompt/completion/total tokens, duration)
  H-->>C: [DONE]
  H-xB: SIGTERM (if still running)
  deactivate P
```

References

- Router: `src/routes/chat.js:16–26`
- Handler (stream): `src/handlers/chat/stream.js`
- SSE helpers: `src/services/sse.js`
- Codex runner: `src/services/codex-runner.js`
- Rate limit: `src/middleware/rate-limit.js`
- Dev logging: `src/dev-logging.js`
