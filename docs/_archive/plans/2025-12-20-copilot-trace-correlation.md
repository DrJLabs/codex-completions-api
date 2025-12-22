# Copilot Trace Correlation Implementation Plan

**Goal:** Add proxy-side Copilot trace correlation (synthetic `copilot_trace_id` + heuristic/edge header support) so Copilot sessions can be correlated without client changes and obsidian-xml defaults can be applied safely.

**Architecture:** Introduce a trace-context helper in `src/lib/trace-ids.js` that returns `{id, source, header}` and stores it on `res.locals`. Update access logs and Responses ingress logs to include `copilot_trace_source` and `copilot_trace_header`. Preserve existing `copilot_trace_id` behavior and keep detection heuristics (User-Agent + optional edge-injected header). Update deployment docs with the edge header injection option.

**Tech Stack:** Node.js, Express, Vitest, existing logging schema.

---

## Acceptance Criteria (Checklist)
- [ ] **AC1:** Every request gets a `copilot_trace_id` (generated if no header) and a `copilot_trace_source` field in access logs.
- [ ] **AC2:** When `x-copilot-trace-id` is present, `copilot_trace_id` equals the header value and `copilot_trace_source` is `"header"` with `copilot_trace_header: "x-copilot-trace-id"`.
- [ ] **AC3:** When no trace headers are present, `copilot_trace_source` is `"generated"` and `copilot_trace_header` is null.
- [ ] **AC4:** Header precedence is `x-copilot-trace-id` → `x-trace-id` → `x-request-id` (first non-empty wins).
- [ ] **AC5:** Docs explain that Copilot clients cannot be changed and trace correlation can be improved via optional edge-injected headers.

## Tests to Verify ACs (Checklist)
- [ ] **T1 (Unit):** `ensureCopilotTraceContext` returns `{id, source, header}` with correct precedence and trimming rules.
- [ ] **T2 (Unit):** `logResponsesIngressRaw` logs `copilot_trace_id`, `copilot_trace_source`, and `copilot_trace_header` for both header-present and header-absent cases.
- [ ] **T3 (Docs):** Prettier check passes for updated docs.

---

## Task 0: Prep and worktree

**Files:**
- None

**Step 0.1: Create a worktree (required)**
- [ ] Run @superpowers:using-git-worktrees to create an isolated worktree for implementation.

**Step 0.2: Verify baseline**
- [ ] Run: `npm run test:unit -- --help`
- Expected: command prints usage and exits 0.

---

## Task 1: Add Copilot trace context helper (unit-test first)

**Files:**
- Create: `tests/unit/lib/trace-ids.spec.js`
- Modify: `src/lib/trace-ids.js`

**Step 1.1: Write the failing unit test**
- [ ] Create `tests/unit/lib/trace-ids.spec.js`:

```js
import { describe, expect, test } from "vitest";
import { ensureCopilotTraceContext } from "../../../src/lib/trace-ids.js";

const makeReq = (headers = {}) => ({ headers });
const makeRes = (locals = {}) => ({ locals });

describe("copilot trace context", () => {
  test("prefers x-copilot-trace-id", () => {
    const req = makeReq({ "x-copilot-trace-id": "copilot-123" });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx).toMatchObject({
      id: "copilot-123",
      source: "header",
      header: "x-copilot-trace-id",
    });
    expect(res.locals.copilot_trace_id).toBe("copilot-123");
  });

  test("falls back to x-trace-id then x-request-id", () => {
    const req = makeReq({ "x-trace-id": "trace-1", "x-request-id": "trace-2" });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx).toMatchObject({ id: "trace-1", source: "header", header: "x-trace-id" });
  });

  test("generates id when no headers", () => {
    const req = makeReq({});
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx.source).toBe("generated");
    expect(ctx.header).toBe(null);
    expect(typeof ctx.id).toBe("string");
    expect(ctx.id.length).toBeGreaterThan(0);
  });

  test("trims and limits header value length", () => {
    const req = makeReq({ "x-copilot-trace-id": `  ${"x".repeat(400)}  ` });
    const res = makeRes();
    const ctx = ensureCopilotTraceContext(req, res);
    expect(ctx.id.length).toBe(256);
  });
});
```

**Step 1.2: Run the unit test and confirm it fails**
- [ ] Run: `npm run test:unit -- tests/unit/lib/trace-ids.spec.js`
- Expected: FAIL (missing `ensureCopilotTraceContext`).

**Step 1.3: Implement the helper (minimal code)**
- [ ] In `src/lib/trace-ids.js`, add a new helper and keep `ensureCopilotTraceId` backward compatible:

```js
const TRACE_HEADERS = ["x-copilot-trace-id", "x-trace-id", "x-request-id"];

const findTraceHeader = (headers = {}) => {
  for (const key of TRACE_HEADERS) {
    const value = normalizeHeaderValue(headers?.[key]);
    if (value) return { value, header: key };
  }
  return { value: null, header: null };
};

export function ensureCopilotTraceContext(req, res) {
  if (!res) {
    const fallback = nanoid();
    return { id: fallback, source: "generated", header: null };
  }
  res.locals = res.locals || {};
  const locals = res.locals;
  const existing = locals.copilot_trace_id || locals[COPILOT_TRACE_KEY];
  if (existing) {
    return {
      id: existing,
      source: locals.copilot_trace_source || "existing",
      header: locals.copilot_trace_header || null,
    };
  }

  const { value, header } = findTraceHeader(req?.headers || {});
  const id = value || nanoid();
  const source = value ? "header" : "generated";
  locals[COPILOT_TRACE_KEY] = id;
  locals.copilot_trace_id = id;
  locals.copilot_trace_source = source;
  locals.copilot_trace_header = header;
  return { id, source, header };
}

export function ensureCopilotTraceId(req, res) {
  return ensureCopilotTraceContext(req, res).id;
}
```

**Step 1.4: Re-run the unit test**
- [ ] Run: `npm run test:unit -- tests/unit/lib/trace-ids.spec.js`
- Expected: PASS.

**Step 1.5: Commit**
- [ ] `git add tests/unit/lib/trace-ids.spec.js src/lib/trace-ids.js`
- [ ] `git commit -m "test(trace): cover copilot trace context"`

---

## Task 2: Log trace source in access + responses ingress logs

**Files:**
- Modify: `src/middleware/access-log.js`
- Modify: `src/handlers/responses/ingress-logging.js`
- Modify: `tests/unit/handlers/responses/ingress-logging.spec.js`

**Step 2.1: Write failing unit tests for ingress logging**
- [ ] Update `tests/unit/handlers/responses/ingress-logging.spec.js` to validate logged fields by spying on `logStructured`:

```js
import { describe, test, expect, vi } from "vitest";
import * as schema from "../../../../src/services/logging/schema.js";
import { logResponsesIngressRaw } from "../../../../src/handlers/responses/ingress-logging.js";

const makeRes = () => ({ locals: {} });

describe("responses ingress logging", () => {
  test("logs header-sourced copilot trace", () => {
    const spy = vi.spyOn(schema, "logStructured").mockReturnValue({});
    const req = { method: "POST", headers: { "x-copilot-trace-id": "copilot-123" } };
    const res = makeRes();
    logResponsesIngressRaw({ req, res, body: { input: "hi" } });
    const [, extras] = spy.mock.calls[0];
    expect(extras.copilot_trace_id).toBe("copilot-123");
    expect(extras.copilot_trace_source).toBe("header");
    expect(extras.copilot_trace_header).toBe("x-copilot-trace-id");
    spy.mockRestore();
  });

  test("logs generated copilot trace when header missing", () => {
    const spy = vi.spyOn(schema, "logStructured").mockReturnValue({});
    const req = { method: "POST", headers: {} };
    const res = makeRes();
    logResponsesIngressRaw({ req, res, body: { input: "hi" } });
    const [, extras] = spy.mock.calls[0];
    expect(extras.copilot_trace_source).toBe("generated");
    expect(extras.copilot_trace_header).toBe(null);
    expect(typeof extras.copilot_trace_id).toBe("string");
    spy.mockRestore();
  });
});
```

**Step 2.2: Run the unit test and confirm it fails**
- [ ] Run: `npm run test:unit -- tests/unit/handlers/responses/ingress-logging.spec.js`
- Expected: FAIL (new fields not logged yet).

**Step 2.3: Update access logging**
- [ ] In `src/middleware/access-log.js`, swap to the new helper and log source/header:

```js
import { ensureCopilotTraceContext } from "../lib/trace-ids.js";

const { id: copilot_trace_id, source, header } = ensureCopilotTraceContext(req, res);
res.locals.copilot_trace_id = copilot_trace_id;
res.locals.copilot_trace_source = source;
res.locals.copilot_trace_header = header;
...
logStructured(..., {
  copilot_trace_id,
  copilot_trace_source: source,
  copilot_trace_header: header,
  ...
});
```

**Step 2.4: Update responses ingress logging**
- [ ] In `src/handlers/responses/ingress-logging.js`, use `ensureCopilotTraceContext` and include the new fields in log extras:

```js
const { id, source, header } = ensureCopilotTraceContext(req, res);
...
logStructured(..., {
  copilot_trace_id: id,
  copilot_trace_source: source,
  copilot_trace_header: header,
  ...
});
```

**Step 2.5: Re-run the unit test**
- [ ] Run: `npm run test:unit -- tests/unit/handlers/responses/ingress-logging.spec.js`
- Expected: PASS.

**Step 2.6: Commit**
- [ ] `git add src/middleware/access-log.js src/handlers/responses/ingress-logging.js tests/unit/handlers/responses/ingress-logging.spec.js`
- [ ] `git commit -m "feat(logging): add copilot trace source to logs"`

---

## Task 3: Document edge-injected trace header option

**Files:**
- Modify: `docs/deployment/production.md`
- Modify: `docs/responses-endpoint/overview.md` (if needed to cross-link)

**Step 3.1: Add Traefik header injection guidance**
- [ ] Add a short section to `docs/deployment/production.md` describing an optional Traefik middleware to inject `x-copilot-trace-id` when User-Agent contains `obsidian/`.

Example snippet to include:

```yaml
# /etc/traefik/dynamic/codex-api.yml
http:
  middlewares:
    copilot-trace:
      headers:
        customRequestHeaders:
          x-copilot-trace-id: "${COPILOT_TRACE_ID:-}" # or a static prefix+request id if available
```

Note: If your edge cannot generate IDs, skip the header and rely on server-generated `copilot_trace_id`.

**Step 3.2: Verify doc formatting**
- [ ] Run: `npx prettier -c docs/deployment/production.md docs/responses-endpoint/overview.md`
- Expected: PASS.

**Step 3.3: Commit**
- [ ] `git add docs/deployment/production.md docs/responses-endpoint/overview.md`
- [ ] `git commit -m "docs: describe copilot trace header injection"`

---

## Task 4: Final verification

**Step 4.1: Run targeted unit tests**
- [ ] Run: `npm run test:unit -- tests/unit/lib/trace-ids.spec.js tests/unit/handlers/responses/ingress-logging.spec.js`
- Expected: PASS.

**Step 4.2: Run lint/format check for touched files**
- [ ] Run: `npx prettier -c src/lib/trace-ids.js src/middleware/access-log.js src/handlers/responses/ingress-logging.js docs/deployment/production.md docs/responses-endpoint/overview.md`
- Expected: PASS.

---

## Execution Notes

Execute sequentially in a single session, following the tasks in order and running the specified tests at each checkpoint.
