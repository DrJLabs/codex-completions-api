# App-Server Metrics and Alerts

## Endpoint and Access

- Endpoint: `GET /metrics` (Prometheus exposition, text format, utf-8).
- Enabled via `PROXY_ENABLE_METRICS=true`; default is `false` to keep the surface internal-only.
- Access guard:
  - Defaults: loopback-only if no token is provided.
  - Provide `PROXY_METRICS_TOKEN=...` and send `Authorization: Bearer <token>` to authenticate.
  - To explicitly allow unauthenticated scrapes (dev-only), set `PROXY_METRICS_ALLOW_UNAUTH=true`.
  - `PROXY_METRICS_ALLOW_LOOPBACK=true` keeps local scrape working when a token is absent.
- Scope egress to internal scrape targets (Traefik/ForwardAuth). Do not expose publicly; reuse existing Traefik network and auth labels.

## Metric Surface (prom-client 15.1.x)

- `codex_http_requests_total{route,method,status_family,model}` — request counts.
- `codex_http_latency_ms_bucket` / `_summary_ms` — latency buckets/summaries (buckets: 50, 100, 200, 400, 800, 1200, 2000, 5000, 10000 ms).
- `codex_http_errors_total{route,method,status_family,model}` — 5xx counts.
- `codex_worker_restarts_total` — current restart count from supervisor.
- `codex_worker_backoff_ms` — next restart backoff or startup latency.
- `codex_worker_ready` — 1 when supervisor reports ready, else 0.
- `codex_streams_active` — SSE/concurrency guard snapshot.
- `codex_tool_buffer_started_total|_flushed_total|_aborted_total{output_mode,reason}` — textual tool buffer transitions.
- `codex_maintenance_mode` — 1 when maintenance flag is enabled, else 0.
- Default process metrics from `prom-client` remain registered for scrape health (cpu, memory, heap).

## Label Hygiene

- HTTP labels limited to: `route` (sanitized path), `method` (upper-case), `status_family` (`2xx`/`4xx`/`5xx`), `model` (bounded to 64 chars).
- Tool buffer labels: `output_mode` (obsidian-xml|openai-json), `reason` (abort|nested_open|finalize|… bounded values).
- No request-level identifiers, user IDs, or query params are emitted in metric labels.

## Guardrails and Retention

- Keep `/metrics` internal or ForwardAuth-guarded; production Traefik labels unchanged.
- Avoid adding new labels without cardinality review; routes/models must stay low-cardinality.
- Metrics registry resets with process; no on-disk retention.

## Dashboard and Alert Templates (example thresholds; tune per NFR002/FR011)

- **Latency:** `codex_http_latency_summary_ms{route="/v1/chat/completions",status_family="2xx"}` — alert when p95 > 1500ms for 5m; p99 > 2500ms for 5m.
- **Error rate:** `rate(codex_http_errors_total{route="/v1/chat/completions"}[5m]) / rate(codex_http_requests_total{route="/v1/chat/completions"}[5m])` > 0.01 for 5m.
- **Throughput:** `rate(codex_http_requests_total[1m])` overlay per route; dashboard panel only.
- **Restarts/backoff:** `increase(codex_worker_restarts_total[10m]) > 0` or `codex_worker_backoff_ms > 0` triggers warning; page if repeating >3 times/hour.
- **Active streams:** `codex_streams_active` gauge; alert if sustained > `PROXY_SSE_MAX_CONCURRENCY` for 2m.
- **Tool buffer anomalies:** `increase(codex_tool_buffer_aborted_total[5m]) > 0` or `rate(codex_tool_buffer_started_total[5m])` spikes without flushes.
- **Maintenance state:** `codex_maintenance_mode` panel and alert when ==1 for >2m; mirror 503 spikes in error-rate alert.

Dashboards should link to runbooks and include scrape target (host/pod), version/build id, and ForwardAuth status for context.

## Artifacts

- Dashboard JSON: `docs/app-server-migration/dashboards/observability-dashboard.json`
- Alert rules (Prometheus-compatible): `docs/app-server-migration/alerts/metrics-alerts.yaml`
