# Enforce Consistent API Key Authentication (Report)

## Objective

Enforce consistent API key authentication for all protected endpoints in `DrJLabs/codex-completions-api`. The proxy must require a valid `PROXY_API_KEY` (or reverse-proxy/ForwardAuth enforcement) for **all** sensitive routes, matching the intended design:

- Bearer token required for:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
- `/healthz` always open
- `/v1/models` open **only** when `PROXY_PROTECT_MODELS=false` (default); requires auth when `PROXY_PROTECT_MODELS=true`
- Diagnostic endpoints remain controlled by their existing flags:
  - `/v1/usage` respects `PROXY_USAGE_ALLOW_UNAUTH`
  - `/__test/*` respects `PROXY_TEST_*` flags

## Constraints

- Use existing auth middleware: `src/middleware/auth.js`
- Use existing config flags for flexibility
- **Do not** expose completions or responses without a valid key
- Maintain compatibility with Traefik ForwardAuth (defense-in-depth OK; avoid conflicts)
- Never log or commit secrets/credentials
- Preserve current dev conveniences (e.g., models list open by default)
- No public API response changes **except** the newly enforced auth requirements
- No measurable performance impact

## Assumptions

- Express (or Express-like) app that mounts routers or route handlers for:
  - `/v1/chat/completions`
  - `/v1/responses`
  - `/v1/models`
  - `/healthz`
- `src/middleware/auth.js` contains a middleware (e.g., `requireApiKey`) that validates:
  - `Authorization: Bearer <token>`
  - token matches `PROXY_API_KEY` (or equivalent config)
- Existing tests use a unit/integration harness (often Vitest + Supertest for unit tests)

---

# Implementation Plan

## 1) Fail-closed at the route mount point

The primary enforcement should happen where routes are mounted, not inside individual handlers.

### Always protected

Mount `requireApiKey` for:

- `POST /v1/chat/completions`
- `POST /v1/responses`

This must protect *all* variants (streaming and non-streaming, alternate handler paths, etc.).

### Always open

Do **not** wrap with auth:

- `GET /healthz`

### Conditional protection

Mount auth only when `PROXY_PROTECT_MODELS=true`:

- `GET /v1/models`

### Preserve flag-based behavior

Keep existing behavior intact for:

- `/v1/usage` (gated by `PROXY_USAGE_ALLOW_UNAUTH`)
- `/__test/*` (gated by existing `PROXY_TEST_*` flags)

---

# Code Changes (Minimal / Focused)

## Commit 1: Enforce API key auth on completions endpoints

### A) Ensure `WWW-Authenticate: Bearer` is returned on 401

In `src/middleware/auth.js`, ensure unauthorized responses set the `WWW-Authenticate` header.

- Do **not** log the presented token or expected token.
- Keep the existing error response body shape (only add the header).

**Patch pattern (adapt to existing structure):**
```js
// src/middleware/auth.js

function unauthorized(res) {
  // Required for clients and for test expectations
  res.setHeader("WWW-Authenticate", "Bearer");
  return res.status(401).json(/* keep your existing body shape */);
}

export function requireApiKey(req, res, next) {
  // const expected = config.PROXY_API_KEY or process.env.PROXY_API_KEY
  // const provided = parseBearerToken(req.headers.authorization)
  if (/* missing or mismatch */) return unauthorized(res);
  return next();
}
```

### B) Apply `requireApiKey` to `/v1/chat/completions` and `/v1/responses`

In the route mounting file (commonly `server.js` or `src/app.js`), apply `requireApiKey` at mount time.

**Router mount example:**
```js
import { requireApiKey } from "./src/middleware/auth.js";
import { PROXY_PROTECT_MODELS } from "./src/config/index.js"; // adjust path

app.get("/healthz", healthzHandler);

// /v1/models: conditional
if (PROXY_PROTECT_MODELS) {
  app.use("/v1/models", requireApiKey, modelsRouter);
} else {
  app.use("/v1/models", modelsRouter);
}

// Always protected:
app.use("/v1/chat/completions", requireApiKey, chatCompletionsRouter);
app.use("/v1/responses", requireApiKey, responsesRouter);

// Leave /v1/usage and /__test/* gating as-is (flags)
```

**Direct handler example:**
```js
app.post("/v1/chat/completions", requireApiKey, chatCompletionsHandler);
app.post("/v1/responses", requireApiKey, responsesHandler);
```

---

# Verification Plan

## Required behaviors

### 1) Protected endpoints require Bearer auth

- `POST /v1/chat/completions` without `Authorization: Bearer ...`  
  - **401**  
  - Includes `WWW-Authenticate: Bearer`

- `POST /v1/responses` without `Authorization: Bearer ...`  
  - **401**  
  - Includes `WWW-Authenticate: Bearer`

With correct bearer token:
- Both endpoints should **pass the auth gate** (not 401)
- Downstream errors (e.g., request validation) may still occur, but must occur **after** auth passes

### 2) `/v1/models` conditional behavior

- When `PROXY_PROTECT_MODELS=false` (default): `GET /v1/models` returns **200** without auth
- When `PROXY_PROTECT_MODELS=true`: `GET /v1/models` requires auth:
  - **401** without token + `WWW-Authenticate: Bearer`
  - **200** with correct token

### 3) `/healthz` always open

- `GET /healthz` returns **200** without auth

### 4) Diagnostics respect flags

- `/v1/usage` behavior unchanged except controlled by `PROXY_USAGE_ALLOW_UNAUTH`
- `/__test/*` behavior unchanged except controlled by `PROXY_TEST_*` flags
- All existing tests must pass

---

# Tests to Add/Update

## Unit tests (example using Vitest + Supertest)

> Adjust the `loadAppFresh()` import to match your repo (`server.js` export or `createApp()` factory).

Create: `tests/unit/auth.enforcement.test.js`

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

async function loadAppFresh() {
  // Ensures env flag changes are picked up if config reads env at import time
  vi.resetModules();
  const mod = await import("../../server.js"); // adjust path if needed
  return mod.app ?? mod.createApp?.() ?? mod.default;
}

const KEY = "unit-test-proxy-key";

describe("API key auth enforcement", () => {
  beforeEach(() => {
    process.env.PROXY_API_KEY = KEY;
    delete process.env.PROXY_PROTECT_MODELS;
    delete process.env.PROXY_USAGE_ALLOW_UNAUTH;
  });

  afterEach(() => {
    delete process.env.PROXY_API_KEY;
    delete process.env.PROXY_PROTECT_MODELS;
    delete process.env.PROXY_USAGE_ALLOW_UNAUTH;
  });

  it("rejects /v1/chat/completions without Authorization (401 + WWW-Authenticate)", async () => {
    const app = await loadAppFresh();
    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTruthy();
  });

  it("rejects /v1/chat/completions with wrong Bearer token", async () => {
    const app = await loadAppFresh();
    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer wrong-key")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTruthy();
  });

  it("allows /v1/chat/completions with correct Bearer token (passes auth gate)", async () => {
    const app = await loadAppFresh();
    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${KEY}`)
      .set("Content-Type", "application/json")
      .send({
        model: "codex-5",
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      });

    // Critical: must not be 401 anymore
    expect(res.status).not.toBe(401);

    // If your unit setup fully mocks upstream, tighten this to expect 200.
    expect([200, 201, 400, 422]).toContain(res.status);
  });

  it("rejects /v1/responses without Authorization (401 + WWW-Authenticate)", async () => {
    const app = await loadAppFresh();
    const res = await request(app)
      .post("/v1/responses")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTruthy();
  });

  it("allows /v1/responses with correct Bearer token (passes auth gate)", async () => {
    const app = await loadAppFresh();
    const res = await request(app)
      .post("/v1/responses")
      .set("Authorization", `Bearer ${KEY}`)
      .set("Content-Type", "application/json")
      .send({
        model: "codex-5",
        input: "ping",
        stream: false,
      });

    expect(res.status).not.toBe(401);
    expect([200, 201, 400, 422]).toContain(res.status);
  });

  it("keeps /healthz open", async () => {
    const app = await loadAppFresh();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });

  it("allows /v1/models without auth when PROXY_PROTECT_MODELS=false (default)", async () => {
    const app = await loadAppFresh();
    const res = await request(app).get("/v1/models");
    expect(res.status).toBe(200);
  });

  it("requires auth for /v1/models when PROXY_PROTECT_MODELS=true", async () => {
    process.env.PROXY_PROTECT_MODELS = "true";
    const app = await loadAppFresh();

    const res = await request(app).get("/v1/models");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTruthy();
  });

  it("usage route respects PROXY_USAGE_ALLOW_UNAUTH", async () => {
    // When false/undefined => should require auth (or be unavailable)
    {
      const app = await loadAppFresh();
      const res = await request(app).get("/v1/usage");
      expect([401, 404]).toContain(res.status);
      if (res.status === 401) {
        expect(res.headers["www-authenticate"]).toBeTruthy();
      }
    }

    // When true => should be accessible without auth (if enabled)
    process.env.PROXY_USAGE_ALLOW_UNAUTH = "true";
    {
      const app = await loadAppFresh();
      const res = await request(app).get("/v1/usage");
      expect([200, 404]).toContain(res.status);
    }
  });
});
```

## Integration tests

Add/extend an integration test that asserts:

- `POST /v1/chat/completions` without auth => `401` + `WWW-Authenticate`
- `POST /v1/responses` without auth => `401` + `WWW-Authenticate`
- `/healthz` => `200` without auth
- `/v1/models` => `200` without auth when `PROXY_PROTECT_MODELS=false`; `401` without auth when `true`

---

# PR & Commit Guidance

Single PR with two small, focused commits:

1. **Enforce API key auth on completions endpoints**
   - Mount `requireApiKey` on `/v1/chat/completions` and `/v1/responses`
   - Gate `/v1/models` only when `PROXY_PROTECT_MODELS=true`
   - Ensure `WWW-Authenticate: Bearer` is present on 401 (middleware)

2. **Add auth regression tests for protected endpoints**
   - Add/extend unit and integration tests for the required behaviors

---

# ForwardAuth Compatibility Notes (Traefik)

- Defense-in-depth is acceptable: keep app-level `requireApiKey` even when Traefik ForwardAuth is enabled.
- Ensure Traefik configuration forwards the `Authorization` header to the backend if you rely on it.
- Avoid logging:
  - `Authorization` header values
  - `PROXY_API_KEY`
  - any derived token values

---

# Local Verification Checklist

Run:
- `npm run test:unit`
- `npm run test:integration`

Confirm:
- Unauthenticated:
  - `POST /v1/chat/completions` => **401** + `WWW-Authenticate: Bearer`
  - `POST /v1/responses` => **401** + `WWW-Authenticate: Bearer`
- Authenticated with correct bearer:
  - Not 401 for both endpoints
- `/v1/models`:
  - **200** unauth when `PROXY_PROTECT_MODELS=false` (default)
  - **401** unauth when `PROXY_PROTECT_MODELS=true`
- `/healthz`:
  - **200** unauth always
- Usage/test routes unchanged except their flags
- Entire test suite passes

