# Task 9 — Security & Configuration Hygiene Review
_Last updated: 2025-12-08_

## Purpose
Assess the repo’s **security posture** and **configuration hygiene** with an emphasis on:
- Authentication/authorization boundaries
- Exposure of diagnostic and telemetry endpoints
- CORS and browser-safety posture
- Rate limiting / DoS controls
- Secrets management + repo hygiene
- Risky defaults and “foot-gun” configuration
- Documented vs implemented security guarantees (drift/contradictions)

This review is **codebase-grounded** (paths + line references included) and assumes the intended deployment is **Traefik + ForwardAuth + Cloudflare**, while also evaluating “direct-to-app” exposure risk.

---

## 1) Security model (as designed vs as implemented)

### Designed / documented model
The PRD states:
- “All protected endpoints require `Authorization: Bearer <PROXY_API_KEY>`”
- Production traffic is pre-authenticated by **Traefik ForwardAuth** (`auth/server.mjs`)
- `/v1/usage*` and `/__test/*` are considered protected surfaces (usage via ForwardAuth; test endpoints via Bearer + flag)  
Refs: `docs/bmad/prd.md` NFR1 + Endpoint table. fileciteturn36file0L1-L6 fileciteturn36file1L23-L32

### Implemented model (actual enforcement points)
In practice, the codebase uses a **split enforcement model**:

1. **In-app bearer enforcement** (chat + responses + completions shim):
- `POST /v1/chat/completions` handlers reject when `Authorization !== Bearer ${CFG.API_KEY}`. fileciteturn26file0L35-L48
- `POST /v1/responses` delegates to chat handlers; same bearer requirement applies. fileciteturn19file2L12-L14
- `POST /v1/completions` is a shim, also delegated into the same auth gate. (Rate limit applies here too; see §3.)

2. **Optional in-app protection** for `/v1/models`:
- Only enforced when `PROXY_PROTECT_MODELS=true`. fileciteturn18file2L1-L32

3. **No in-app auth** on `/v1/usage*`:
- `src/routes/usage.js` has no bearer checks; it assumes upstream auth. fileciteturn28file0L1-L136

4. **No in-app auth** on `PROXY_TEST_ENDPOINTS` endpoints:
- When the flag is enabled, `/__test/conc` and `/__test/conc/release` are exposed without bearer enforcement. fileciteturn20file0L41-L63  
This **contradicts the PRD**, which specifies “Bearer required + `PROXY_TEST_ENDPOINTS=true`”. fileciteturn36file1L30-L32

5. **ForwardAuth sidecar** exists and is used in docker-compose:
- `auth/server.mjs` validates bearer for Traefik forwardauth. fileciteturn1file0L40-L76
- Traefik labels attach forwardauth middleware to the `/v1` router (excluding preflight + models). fileciteturn24file0L32-L73

**Key takeaway:** The effective security posture is strong *when deployed exactly as intended*, but several endpoints are unsafe if the app is exposed directly or misconfigured.

---

## 2) High-impact findings (gaps, contradictions, foot-guns)

### H1 — `/v1/usage` and `/v1/usage/raw` are unauthenticated in-app
- Code exposes usage aggregation and raw NDJSON readout without bearer checks. fileciteturn28file0L1-L136
- PRD expects these endpoints to be protected “via ForwardAuth”. fileciteturn36file1L30-L31

**Risk:** If the Node app is reachable without Traefik ForwardAuth (local runs, port exposure, misrouted reverse proxy), usage telemetry can leak. Depending on payloads, that can include sensitive operational information.

**Recommendation:** Add an in-app auth middleware for `/v1/usage*` (or a “requireEdgeAuth” gate that can be disabled explicitly in dev). See §8.

---

### H2 — `PROXY_TEST_ENDPOINTS` exposes a write primitive without auth
When `PROXY_TEST_ENDPOINTS=true`, app exposes:
- `POST /__test/conc/release`, which can write to an arbitrary path via `STREAM_RELEASE_FILE` (if configured). fileciteturn20file0L50-L63

**Risk:** If the flag is enabled in a reachable environment (accidental prod flag flip), this becomes an **unauthenticated arbitrary file-write** primitive (within container permissions). That is a serious vulnerability class.

**Recommendation:** Require bearer auth for all test endpoints and also restrict to loopback by default. See §8.

---

### H3 — In-app rate limiting can be bypassed via `/v1/responses`
The optional token-bucket middleware only guards:
- `POST /v1/chat/completions`
- `POST /v1/completions`  
It does **not** guard `/v1/responses`. fileciteturn14file0L1-L53

**Risk:** If in-app rate limiting is relied on as a defense-in-depth control, clients can route to `/v1/responses` to bypass it.

**Recommendation:** Add `/v1/responses` to the guarded path list (or use router-level middleware rather than matching on `req.path`). See §8.

---

### H4 — Server binds to all interfaces but logs “127.0.0.1”
`server.js` calls:
- `app.listen(PORT, ...)` (no host argument) and logs `http://127.0.0.1:${PORT}`. fileciteturn31file0L24-L29

In Node/Express, omitting the host typically binds to **all interfaces** (0.0.0.0). The log line is therefore misleading.

**Risk:** Operators may believe they are only exposing localhost while actually exposing the service to the LAN/WAN. This becomes materially worse because config defaults to `PROXY_API_KEY=codex-local-secret`. fileciteturn29file0L43-L52

**Recommendation:** Bind explicitly and/or log the actual bind address. See §8.

---

### H5 — Security-related defaults are permissive and/or contradictory to docs
Key defaults:
- `API_KEY` defaults to `"codex-local-secret"`. fileciteturn29file0L43-L46
- CORS is enabled by default with `PROXY_CORS_ALLOWED_ORIGINS="*"`. fileciteturn29file1L13-L15
- PRD claims sandbox defaults to `danger-full-access`, but code defaults to `read-only`. fileciteturn36file0L5-L6 fileciteturn29file0L51-L53

**Risk:** Defaults are optimized for “it works locally,” but they increase the blast radius of configuration mistakes.

**Recommendation:** Implement “fail-fast in prod” and align docs with reality. See §8.

---

## 3) Authentication & authorization deep dive

### Chat/Responses endpoints (in-app auth)
- Both streaming and non-stream chat handlers enforce `Authorization: Bearer ${CFG.API_KEY}`. fileciteturn26file0L35-L48 fileciteturn19file1L44-L57
- Error response uses OpenAI-style envelope with `code:"invalid_api_key"`. fileciteturn22file0L1-L20

**Strengths**
- Simple and consistent enforcement across handler variants.
- Uses explicit equality check; no partial acceptance.

**Gaps / opportunities**
- No key rotation/multi-key support (operational).
- No structured “auth middleware” at router level; auth is duplicated in handlers (maintainability risk).

### Models endpoint (optionally protected)
- `/v1/models` may be public by design (default). fileciteturn18file2L1-L32
- That matches PRD flexibility via `PROXY_PROTECT_MODELS`.

### Usage endpoints (rely on edge)
- This is acceptable *if and only if* Traefik is always in front and configured correctly.
- In app, there is no “defense in depth” check.

### Test endpoints (dev-only) — doc mismatch
- PRD states bearer required; code does not enforce.
- This should be corrected even if “dev only,” because the toggle is operator-controlled and mistakes happen.

---

## 4) Rate limiting / DoS controls

### Edge rate limiting (Traefik)
`docker-compose.yml` defines a rate limit middleware. fileciteturn24file0L74-L84

### In-app token bucket (optional)
- Controlled by `PROXY_RATE_LIMIT_ENABLED`, window/max config. fileciteturn29file1L33-L37
- Middleware uses bearer token as primary key, else falls back to `req.ip`. fileciteturn14file0L13-L37

**Important nuance:** Express trust-proxy is not configured (see `server.js`), so `req.ip` will be the immediate peer (e.g., Traefik container IP) rather than true client IP. This is acceptable if you always have bearer tokens, but it reduces the usefulness of IP-based limiting.

**Gap:** `/v1/responses` bypass (H3).

---

## 5) CORS and browser safety

### App-level CORS
CORS is implemented in `src/utils.js` and applied globally when `PROXY_ENABLE_CORS` is truthy. fileciteturn29file1L13-L15 fileciteturn16file0L33-L84

Key behaviors:
- With allow-all (`*`), the server **reflects Origin** and sets `Access-Control-Allow-Credentials: true` when Origin is present. fileciteturn16file0L33-L56
- It echoes `Access-Control-Request-Headers` when present. fileciteturn16file0L60-L67
- Global OPTIONS responder returns 204. fileciteturn20file0L21-L34

### Edge-level CORS
Traefik also sets explicit CORS origin allowlists. fileciteturn24file0L87-L106

**Potential issue:** If the app sets permissive CORS headers and Traefik sets restrictive headers, behavior can become inconsistent (duplicate headers, or app “wins” depending on proxy behavior). While CORS is not your primary auth boundary (bearer token is), this can cause hard-to-debug client behavior and may widen exposure if cookies are ever introduced later.

**Recommendations**
- In production, prefer **one owner** for CORS (usually the edge). Set `PROXY_ENABLE_CORS=false` in prod *or* make the allowlist match Traefik exactly.
- Avoid `credentials:true` unless you actually use cookies.

---

## 6) Logging, redaction, and leakage risk

### Access logs
Access logs are structured and do **not** include bearer tokens; they only log `auth:"present|absent"`. fileciteturn21file0L1-L37

### Dev trace / proto logs
- `logHttpRequest` sanitizes headers and bodies. fileciteturn12file0L6-L42
- `appendProtoEvent` applies a schema that redacts sensitive keys (`payload`, `body`, `headers`, `messages`, `response`). fileciteturn13file0L63-L85 fileciteturn12file2L1-L45

### Remaining risk: console logs in dev handler
In `src/handlers/chat/shared.js`, the code prints:
- the full `messages` array and full concatenated prompt to stdout. fileciteturn25file0L77-L90

**Impact:** In dev or staging where real user data may appear, this can leak sensitive content to log collectors.

**Recommendation:** Gate these prints behind an explicit “debug prompts” flag and ensure it is false by default.

---

## 7) Secrets management and repository hygiene

### What’s good
- `.dockerignore` excludes `.env*`, `.codex-api/**`, `.codev/**` from build context. fileciteturn35file0L10-L23
- `secretlint` is configured (recommended preset). fileciteturn33file0L1-L7
- `secretlintignore` excludes known secret-bearing directories from scanning (reduces noise). fileciteturn34file0L1-L5

### What needs attention
- A repository `.gitignore` was **not found** via code search (may be absent). If absent, nothing prevents accidentally committing `.env`, `.codex-api/auth.json`, or local logs.  
If it exists but is not indexed, verify in the repo root manually.

**Recommendation:** Add a `.gitignore` that ignores `.env*`, `.codex-api/**` (with an allowlist for README), `.codev/**`, logs, test outputs, etc.

### Systemd unit foot-gun
The shipped user service hardcodes:
- `Environment=PROXY_API_KEY=codex-local-secret` fileciteturn30file0L6-L9

**Recommendation:** Treat this unit as an example only; use an `EnvironmentFile=` and remove default secrets. Add basic systemd hardening (see §8).

---

## 8) Remediation backlog (prioritized, concrete)

### Priority 0 (security correctness)
1. **Add auth middleware for `/v1/usage*`** (defense-in-depth)  
   - Option A: require bearer always (recommended), with an explicit `PROXY_ALLOW_UNAUTH_USAGE=true` for local-only scenarios.
2. **Require bearer for test endpoints** and also restrict to loopback by default  
   - Add a small middleware: `requireTestModeAndAuth()` that checks both `PROXY_TEST_ENDPOINTS` and bearer token equality (and optionally loopback).
3. **Apply in-app rate limiting to `/v1/responses`** (and any other write endpoints)  
   - Replace path checks with router-scoped middleware for all POST `/v1/*` except those explicitly excluded.

### Priority 1 (reduce configuration foot-guns)
4. **Bind explicitly (or log truthfully)**  
   - Add `HOST` config and pass it to `listen(PORT, HOST)`; log the actual address.
   - Default: `127.0.0.1` for `PROXY_ENV=dev` and `0.0.0.0` when running in container (or explicit).
5. **Fail fast when API key is default in non-dev**  
   - Example rule: if `PROXY_ENV !== "dev"` and `PROXY_API_KEY` is unset or equals `"codex-local-secret"`, exit at startup with a clear message.
6. **Align docs vs code on sandbox defaults**  
   - Either change default to match PRD (`danger-full-access`) or update PRD to reflect safer default (`read-only`). Prefer safer default unless a workflow truly requires full access.

### Priority 2 (hygiene and hardening)
7. **Single owner for CORS**  
   - If Traefik owns CORS, set `PROXY_ENABLE_CORS=false` in prod. If app owns CORS, remove Traefik CORS headers middleware to avoid duplication.
8. **Add optional `helmet` (or minimal headers)** when running without edge  
   - Only if you support direct exposure scenarios.
9. **Systemd hardening** (if systemd mode is a supported deployment target)  
   - Use `EnvironmentFile=`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `ReadWritePaths=` for `.codex-api` / workdir only, etc.

---

## 9) Verification checklist (tests + operational)
- Add integration tests:
  - `/v1/usage` returns 401 without bearer when running without ForwardAuth.
  - `/__test/*` returns 401 without bearer even when `PROXY_TEST_ENDPOINTS=true`.
  - Rate limit applies to `/v1/responses` when enabled.
- Add smoke checks:
  - Startup fails in prod if API key is default.
  - Log reports actual bind address, not localhost unless configured.
- Add docs checks:
  - PRD security table matches actual enforcement.
  - Runbooks clearly distinguish “edge-protected” vs “app-protected” endpoints.

---

## Appendix — Key files reviewed
- Auth & routing:
  - `src/handlers/chat/nonstream.js` (bearer enforcement) fileciteturn26file0
  - `src/handlers/chat/stream.js` (bearer enforcement) fileciteturn19file1
  - `src/routes/usage.js` (no in-app auth) fileciteturn28file0
  - `src/app.js` (test endpoints, middleware ordering) fileciteturn20file0
  - `auth/server.mjs` (ForwardAuth) fileciteturn1file0
- Config:
  - `src/config/index.js` (defaults, toggles) fileciteturn29file0
- Rate limit / CORS:
  - `src/middleware/rate-limit.js` fileciteturn14file0
  - `src/utils.js` (`applyCors`) fileciteturn16file0
- Bootstrap & binding:
  - `server.js` (listen + misleading log) fileciteturn31file0
- Deployment:
  - `docker-compose.yml` (Traefik forwardauth + CORS + rate limit) fileciteturn24file0
  - `systemd/codex-openai-proxy.service` (default secret) fileciteturn30file0
