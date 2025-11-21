# Incident Runbook — App-Server Observability (Story 3.4)

## Scope and Links
- Dashboard JSON: `docs/app-server-migration/dashboards/observability-dashboard.json` (panels: latency p95/p99, error rate, restart/backoff, tool_buffer started/aborted).
- Alert rules: `docs/app-server-migration/alerts/metrics-alerts.yaml` (owner=`sre`, page_service=`codex-app`).
- Metrics schema: `docs/app-server-migration/metrics-and-alerts.md`.
- JSON-RPC schema reference: `docs/app-server-migration/app-server-protocol.schema.json`.
- Trace helper: `scripts/dev/trace-by-req-id.js` (stitches access/proto/usage logs by `req_id`).

## Triage Playbook by Signal
1) **Latency SLO breach (p95 > baseline+5% for 3m)**
   - Query: `histogram_quantile(0.95, sum by (le,route,method,status_family) (rate(codex_http_latency_ms_bucket{route="/v1/chat/completions"}[5m])))`.
   - Check restarts/backoff panels for correlated spikes.
   - Run trace helper on a recent slow `req_id`:  
     `node scripts/dev/trace-by-req-id.js --req-id <id> --access-log .codex-api/access.ndjson --proto-log .codex-api/proto.ndjson --usage-log .codex-api/usage.ndjson`.
   - If worker backoff seen (`codex_worker_backoff_ms > 0`), capture `/readyz` payload and escalate.

2) **Error rate ≥2% over 5m**
   - Panel: Error Ratio.
   - Inspect `/readyz` for restart streak; check recent deploy/flag flips.
   - Trace helper on failing `req_id` to see backend errors vs. maintenance responses.

3) **Restart frequency >3 in 10m**
   - Panel: Worker Restarts and Backoff.
   - Collect `engine` logs around exits; confirm `codex_worker_backoff_ms` matches backoff policy (250ms→5s).
   - If restarts persist, enable maintenance flag (see below) to drain traffic, then follow escalation ladder.

4) **Tool buffer anomaly (gauge >0 within 2m)**
   - Panel: Tool Buffer Aborted/Started rates plus `codex_tool_buffer_anomaly`.
   - Inspect recent tool-call streams; verify `PROXY_STOP_AFTER_TOOLS_MODE`/`PROXY_TOOL_BLOCK_MAX` settings.
   - Use `scripts/dev/trace-by-req-id.js` with a tool-call `req_id` to confirm textual `<use_tool>` buffering did not duplicate or truncate chunks.

5) **Maintenance flag enabled**
   - Verify intent with on-call; ensure `codex_maintenance_mode` returns to 0 after action.
   - Confirm `/readyz` returns 200 before clearing maintenance.

## Maintenance Toggle (guarded)
- Endpoint documented in `docs/codex-proxy-tool-calls.md` and `docs/architecture.md`.
- Always announce enable/disable in incident channel; record timestamps in evidence log.

## Escalation Ladder
1. On-call SRE (pager: `codex-app`, severity=critical).
2. Observability owner (`sre` group) if dashboards or alerts are broken.
3. App-server dev lead if restart backoff or transport errors persist.

## Evidence Capture (dry-run + real incidents)
- Store logs/screenshots under `docs/app-server-migration/alerts/evidence/3-4/`.
- Minimum set:
  - Alert firing + clear timestamps.
  - Screenshot of relevant dashboard panels (latency, error rate, restarts/backoff, tool_buffer_*).
  - Trace helper output for one incident `req_id`.
  - `/readyz` and `/metrics` snippets when restarts/backoff occur.
- For dry-run drills, record commands run, synthetic trigger method, and outcomes in `docs/app-server-migration/alerts/evidence/3-4/dry-run.md`.

## Validation Checklist (post-incident or drill)
- Alert cleared after remediation (latency back under baseline+5% for 3m; error rate <2%; restarts stable; tool_buffer_anomaly back to 0).
- Runbook links and dashboard links accessible from Grafana UI.
- Evidence artifacts saved to the evidence folder and referenced in the story file.
