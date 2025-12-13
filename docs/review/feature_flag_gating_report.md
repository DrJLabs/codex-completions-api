# Feature-Flag Gating Review & Test Coverage Plan (Proxy)

## Goal
Review all configuration flags related to feature gating in the proxy, ensure they work as intended, and improve test coverage for them. The objective is to be confident that enabling or disabling features via env vars is effective and that defaults are secure.

**Focus areas**
- `/v1/responses` endpoint toggle
- metrics exposure
- usage auth bypass
- rate limiting
- test-only endpoints

---

## Reasoning
You want high confidence that “feature gating” flags truly gate behavior (**route not mounted → hard 404; mounted → behaves normally**), and that defaults are safe (especially for metrics, usage auth bypass, rate limiting, and test-only endpoints). The highest‑value approach is an integration-style toggle test suite that boots a fresh Express app instance under different `process.env` settings, plus a couple of targeted “remote vs loopback” checks that don’t rely on spoofable headers. Where endpoint business logic would otherwise require upstream calls, the tests should assert **gating semantics** (404 vs non‑404; 401/403 vs non‑401) rather than full upstream success, unless you already have stable mocking in place.

---

## What to add

### 1) New test suite focused on feature flags
Create a dedicated test file:
- `test/configToggles.spec.js`

This suite should:
- start the app with different env permutations
- assert **route registration** (404 vs non‑404)
- assert **auth/loopback protections** (403/401 vs 200)
- assert **rate limiting triggers** (429)

### 2) Test helper to reload the app with isolated env
Feature flags are often read at module-import time (e.g., config built once). To avoid cross-test contamination, use a helper that:
- applies env overrides
- clears `require.cache` for `src/**`
- re-requires `src/app.js` fresh

Suggested helper:
- `test/helpers/loadFreshApp.js`

### 3) Documentation update
Ensure `docs/configuration.md` (or equivalent) lists:
- each flag
- default
- security implications / safe usage notes

---

## Concrete test implementation (drop-in examples)

### `test/helpers/loadFreshApp.js`
```js
// test/helpers/loadFreshApp.js
'use strict';

const path = require('path');

const SRC_ROOT = path.resolve(__dirname, '../../src');

/**
 * Apply env overrides for the duration of a test and return a restore function.
 * Passing `undefined` deletes the env var (forces default behavior).
 */
function applyEnv(overrides) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return function restoreEnv() {
    for (const [key, oldValue] of Object.entries(previous)) {
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  };
}

/**
 * Purge Node's require cache for everything under src/.
 * This forces config + app to be re-evaluated with the new env vars.
 */
function purgeSrcRequireCache() {
  const prefix = SRC_ROOT + path.sep;
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(prefix)) {
      delete require.cache[modulePath];
    }
  }
}

/**
 * Load the Express app fresh.
 * Supports either `module.exports = app` or `{ app }` or `default`.
 */
function loadFreshApp() {
  purgeSrcRequireCache();

  const mod = require(path.join(SRC_ROOT, 'app.js'));
  const app = (mod && (mod.app || mod.default)) || mod;

  if (!app || typeof app.use !== 'function') {
    throw new Error(
      'Expected src/app.js to export an Express app (or { app } / default export).'
    );
  }
  return app;
}

module.exports = {
  applyEnv,
  loadFreshApp,
};
```

### `test/configToggles.spec.js`
```js
// test/configToggles.spec.js
'use strict';

const request = require('supertest');
const os = require('os');

const { applyEnv, loadFreshApp } = require('./helpers/loadFreshApp');

function getNonLoopbackIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

function authHeaders(token = 'sk-proxy-test') {
  // Send both common patterns; requireApiKey implementations vary.
  return {
    Authorization: `Bearer ${token}`,
    'X-API-Key': token,
  };
}

describe('Feature flag gating (route mount + security defaults)', () => {
  let restoreEnv = null;

  afterEach(() => {
    if (restoreEnv) restoreEnv();
    restoreEnv = null;
  });

  describe('Responses endpoint: PROXY_ENABLE_RESPONSES', () => {
    test('defaults to enabled (route should be mounted, i.e., not 404)', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_RESPONSES: undefined, // force default
      });
      const app = loadFreshApp();

      const res = await request(app).post('/v1/responses').send({});

      // We only assert "not 404" because auth/body validation may still reject.
      expect(res.status).not.toBe(404);
    });

    test('when disabled, /v1/responses is cleanly absent (404)', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_RESPONSES: 'false',
      });
      const app = loadFreshApp();

      // Verify no partial behavior: multiple methods and subpaths should 404.
      const res1 = await request(app).post('/v1/responses').send({});
      const res2 = await request(app).get('/v1/responses');
      const res3 = await request(app).post('/v1/responses/anything').send({});

      expect(res1.status).toBe(404);
      expect(res2.status).toBe(404);
      expect(res3.status).toBe(404);
    });
  });

  describe('Metrics: PROXY_ENABLE_METRICS (+ token/loopback protections)', () => {
    test('default is disabled: /metrics is not registered (404)', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_METRICS: undefined,
      });
      const app = loadFreshApp();

      const res = await request(app).get('/metrics');
      expect(res.status).toBe(404);
    });

    test('when enabled + PROXY_METRICS_TOKEN set: unauthenticated request is rejected', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_METRICS: 'true',
        PROXY_METRICS_TOKEN: 'metrics-test-token',
      });
      const app = loadFreshApp();

      const res = await request(app).get('/metrics');
      expect([401, 403]).toContain(res.status);
    });

    test('when enabled + PROXY_METRICS_TOKEN set: Bearer token grants access', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_METRICS: 'true',
        PROXY_METRICS_TOKEN: 'metrics-test-token',
      });
      const app = loadFreshApp();

      const res = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-test-token');

      expect(res.status).toBe(200);
      // Prometheus text format is expected; keep this tolerant.
      expect(res.text).toMatch(/#\s*HELP|#\s*TYPE|process_|nodejs_/);
    });

    test('when enabled with NO token: loopback is allowed by default; non-loopback is rejected', async () => {
      restoreEnv = applyEnv({
        PROXY_ENABLE_METRICS: 'true',
        PROXY_METRICS_TOKEN: undefined, // no token → should fall back to loopback-only
        // Leave ALLOW_LOOPBACK/ALLOW_UNAUTH unset to validate defaults.
      });
      const app = loadFreshApp();

      // Loopback (supertest in-process) should be allowed by default.
      const loopbackRes = await request(app).get('/metrics');
      expect(loopbackRes.status).toBe(200);

      // Non-loopback: start a real listener and connect via the container/host interface IP.
      const ip = getNonLoopbackIPv4();
      if (!ip) {
        // If no non-loopback interface exists (rare in CI), we can't validate this path reliably.
        // Consider adding a unit-test hook if needed.
        return;
      }

      const server = app.listen(0, '0.0.0.0');
      try {
        const { port } = server.address();
        const remoteRes = await request(`http://${ip}:${port}`).get('/metrics');
        expect([401, 403]).toContain(remoteRes.status);
      } finally {
        server.close();
      }
    });
  });

  describe('Usage endpoints: PROXY_USAGE_ALLOW_UNAUTH', () => {
    test('default (false): unauthenticated /v1/usage is blocked by requireApiKey (401)', async () => {
      restoreEnv = applyEnv({
        PROXY_USAGE_ALLOW_UNAUTH: undefined, // default false
        // Ensure the proxy actually requires an API key in test:
        PROXY_API_KEY: 'sk-proxy-test',
        PROXY_API_KEYS: 'sk-proxy-test', // harmless if unused
      });
      const app = loadFreshApp();

      const res = await request(app).get('/v1/usage');
      expect(res.status).toBe(401);
    });

    test('when PROXY_USAGE_ALLOW_UNAUTH=true: /v1/usage is not blocked by auth middleware', async () => {
      restoreEnv = applyEnv({
        PROXY_USAGE_ALLOW_UNAUTH: 'true',
        PROXY_API_KEY: 'sk-proxy-test',
        PROXY_API_KEYS: 'sk-proxy-test',
      });
      const app = loadFreshApp();

      const res = await request(app).get('/v1/usage');

      // This assertion is intentionally about the gating behavior.
      // The handler may still 4xx on missing query params; what must NOT happen is auth-blocking.
      expect([401, 403, 404]).not.toContain(res.status);
    });
  });

  describe('Rate limiting: PROXY_RATE_LIMIT_ENABLED (+ window/max)', () => {
    test('when enabled: requests are rate-limited (3rd request gets 429 when max=2)', async () => {
      restoreEnv = applyEnv({
        PROXY_RATE_LIMIT_ENABLED: 'true',
        PROXY_RATE_LIMIT_MAX: '2',
        PROXY_RATE_LIMIT_WINDOW_MS: '1000',
      });
      const app = loadFreshApp();

      // Use a path that does not require knowledge of upstream functionality.
      // If your rate limiter is global middleware, it will apply even to 404 routes.
      const path = '/__rate_limit_probe__';

      const r1 = await request(app).get(path);
      const r2 = await request(app).get(path);
      const r3 = await request(app).get(path);

      expect(r1.status).not.toBe(429);
      expect(r2.status).not.toBe(429);
      expect(r3.status).toBe(429);
    });

    test('when disabled: same request loop does NOT 429', async () => {
      restoreEnv = applyEnv({
        PROXY_RATE_LIMIT_ENABLED: 'false',
        PROXY_RATE_LIMIT_MAX: '2',
        PROXY_RATE_LIMIT_WINDOW_MS: '1000',
      });
      const app = loadFreshApp();

      const path = '/__rate_limit_probe__';

      const r1 = await request(app).get(path);
      const r2 = await request(app).get(path);
      const r3 = await request(app).get(path);

      expect(r1.status).not.toBe(429);
      expect(r2.status).not.toBe(429);
      expect(r3.status).not.toBe(429);
    });
  });

  describe('Test-only endpoints: PROXY_TEST_ENDPOINTS (+ PROXY_TEST_ALLOW_REMOTE)', () => {
    test('default disabled: /__test/conc is not registered (404)', async () => {
      restoreEnv = applyEnv({
        PROXY_TEST_ENDPOINTS: undefined, // default false
      });
      const app = loadFreshApp();

      const res = await request(app).get('/__test/conc');
      expect(res.status).toBe(404);
    });

    test('when enabled: loopback request with auth returns data', async () => {
      restoreEnv = applyEnv({
        PROXY_TEST_ENDPOINTS: 'true',
        PROXY_TEST_ALLOW_REMOTE: undefined, // default false
        PROXY_API_KEY: 'sk-proxy-test',
        PROXY_API_KEYS: 'sk-proxy-test',
      });
      const app = loadFreshApp();

      const res = await request(app)
        .get('/__test/conc')
        .set(authHeaders('sk-proxy-test'));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toBeTruthy();
    });

    test('when enabled + PROXY_TEST_ALLOW_REMOTE=false: non-loopback is blocked (403)', async () => {
      restoreEnv = applyEnv({
        PROXY_TEST_ENDPOINTS: 'true',
        PROXY_TEST_ALLOW_REMOTE: 'false',
        PROXY_API_KEY: 'sk-proxy-test',
        PROXY_API_KEYS: 'sk-proxy-test',
      });
      const app = loadFreshApp();

      const ip = getNonLoopbackIPv4();
      if (!ip) return;

      const server = app.listen(0, '0.0.0.0');
      try {
        const { port } = server.address();
        const res = await request(`http://${ip}:${port}`)
          .get('/__test/conc')
          .set(authHeaders('sk-proxy-test'));

        expect(res.status).toBe(403);
      } finally {
        server.close();
      }
    });
  });
});
```

**Why these tests**
- The gating condition you care about is deterministically testable: “route mounted or not,” and “protected or not.”
- For remote-vs-loopback checks, using a real listener + non-loopback interface avoids reliance on `X-Forwarded-For` behavior (which can vary with `trust proxy`).

---

## Minor code tweak to consider (only if tests expose an issue)

### Boolean env parsing “false” bug
If any config flag is parsed like:

```js
const enabled = !!process.env.PROXY_ENABLE_METRICS;
```

Then `PROXY_ENABLE_METRICS=false` becomes truthy and **silently enables the feature**. The new tests will catch that.

If you see failures consistent with this, standardize boolean parsing:

```js
function parseBool(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}
```

…and use it consistently for all feature flags.

---

## Documentation update (config reference)

If you already have `docs/configuration.md`, append a section like this; otherwise create it.

```md
## Feature gating flags

### PROXY_ENABLE_RESPONSES
- Default: `true`
- Effect: When `false`, the `/v1/responses` router is not mounted and requests to `/v1/responses` MUST return `404`.
- Notes: Default `true` is acceptable given feature stability; document explicitly.

### PROXY_ENABLE_METRICS
- Default: `false`
- Effect:
  - When `false`, `/metrics` is not registered (`404`).
  - When `true`, `/metrics` is exposed but protected (token and/or loopback).
- Related:
  - `PROXY_METRICS_TOKEN` (no default): When set, requires `Authorization: Bearer <token>`.
  - Metrics safety defaults in `src/routes/metrics.js`: `ALLOW_LOOPBACK=true`, `ALLOW_UNAUTH=false`.

### PROXY_USAGE_ALLOW_UNAUTH
- Default: `false`
- Effect:
  - When `false`, `/v1/usage` requires proxy API key (`requireApiKey`).
  - When `true`, `/v1/usage` is public (intended for local debugging only).

### PROXY_RATE_LIMIT_ENABLED (+ PROXY_RATE_LIMIT_WINDOW_MS, PROXY_RATE_LIMIT_MAX, ...)
- Default: `false`
- Effect: Enables global rate limiting middleware.
- Security/ops: Recommend enabling in production environments where the proxy is exposed beyond localhost.

### PROXY_TEST_ENDPOINTS (+ PROXY_TEST_ALLOW_REMOTE)
- Default: `false`
- Effect:
  - When `false`, `/__test/*` routes are not registered (`404`).
  - When `true`, test endpoints are available but require auth and are loopback-only by default.
- Related:
  - `PROXY_TEST_ALLOW_REMOTE` default `false`: keep false except CI/dev scenarios where remote access is explicitly required.
```

---

## Commit message (as requested)
Use a single commit with a message like:

**`test: verify feature flags (responses, metrics, usage, rate limit, test endpoints)`**

Include:
- `test/helpers/loadFreshApp.js`
- `test/configToggles.spec.js`
- `docs/configuration.md` updates (or creation)

---

## Optional: stricter “200 OK” assertions
If `/v1/usage` and `/v1/responses` require specific query params or upstream calls, you can tighten the tests to expect `200` by adding a stable mock layer (e.g., `nock`) that intercepts outbound requests and returns deterministic fixtures. The suite above focuses on gating behavior and secure defaults.

