# Add input validation for completions requests

PR title: **Add input validation for completions requests**

This report proposes a focused, low-overhead implementation that:

- Validates **required fields + types** for `/v1/chat/completions` and legacy `/v1/completions`
- Enforces **configurable limits** (`PROXY_MAX_PROMPT_TOKENS`, `PROXY_MAX_CHAT_CHOICES`) *before* invoking Codex CLI
- Returns **OpenAI-style JSON errors** (`{ error: { message, type, param, code } }`) with **HTTP 400** for invalid inputs
- Ensures **invalid JSON** never yields an HTML error page (still **400**, but JSON body)
- Catches Codex CLI exceptions and returns **clean JSON 500** (or passes through upstream OpenAI-shaped errors if the CLI provides them)

> Note: Code snippets below are illustrative/pseudocode and may use CommonJS (`require`/`module.exports`) or Jest/Supertest conventions. This repo is ESM (`type: "module"`) and uses Vitest + `node-fetch` integration tests that spawn `server.js`; adapt paths/imports accordingly.

---

## Patch

### 1) Standardize OpenAI-style errors

**`src/errors.js`** (new or extend existing `errors.js`)

```diff
diff --git a/src/errors.js b/src/errors.js
new file mode 100644
--- /dev/null
+++ b/src/errors.js
@@
+/**
+ * OpenAI-compatible error helpers.
+ *
+ * Response shape:
+ *   { error: { message: string, type: string, param: string|null, code: string|null } }
+ */
+
+class OpenAIProxyError extends Error {
+  /**
+   * @param {number} status
+   * @param {string} message
+   * @param {{type?: string, param?: string|null, code?: string|null}} [opts]
+   */
+  constructor(status, message, opts = {}) {
+    super(message);
+    this.name = "OpenAIProxyError";
+    this.status = status;
+    this.type = opts.type ?? "invalid_request_error";
+    this.param = opts.param ?? null;
+    this.code = opts.code ?? null;
+  }
+}
+
+/**
+ * @param {import("express").Response} res
+ * @param {number} status
+ * @param {string} message
+ * @param {{type?: string, param?: string|null, code?: string|null}} [opts]
+ */
+function sendOpenAIError(res, status, message, opts = {}) {
+  const body = {
+    error: {
+      message,
+      type: opts.type ?? (status >= 500 ? "server_error" : "invalid_request_error"),
+      param: opts.param ?? null,
+      code: opts.code ?? null,
+    },
+  };
+  return res.status(status).json(body);
+}
+
+/**
+ * Detect body-parser / express.json invalid JSON errors.
+ * Express uses body-parser internally; invalid JSON typically yields SyntaxError + status 400.
+ */
+function isInvalidJsonBodyError(err) {
+  return (
+    err instanceof SyntaxError &&
+    err.status === 400 &&
+    // body-parser sets `type` for parse failures; in some cases `body` is also present.
+    (err.type === "entity.parse.failed" || Object.prototype.hasOwnProperty.call(err, "body"))
+  );
+}
+
+/**
+ * Some upstream libs (including OpenAI SDKs) throw objects like:
+ *   { status: 400, error: { message, type, param, code } }
+ *
+ * This extracts a pass-through response if possible.
+ *
+ * @param {unknown} err
+ * @returns {{ status: number, body: any } | null}
+ */
+function normalizeUpstreamOpenAIError(err) {
+  if (!err || typeof err !== "object") return null;
+  const anyErr = /** @type {any} */ (err);
+  if (anyErr.error && typeof anyErr.error === "object" && typeof anyErr.error.message === "string") {
+    const status = typeof anyErr.status === "number" ? anyErr.status : 500;
+    return {
+      status,
+      body: {
+        error: {
+          message: anyErr.error.message,
+          type: anyErr.error.type ?? (status >= 500 ? "server_error" : "invalid_request_error"),
+          param: anyErr.error.param ?? null,
+          code: anyErr.error.code ?? null,
+        },
+      },
+    };
+  }
+  return null;
+}
+
+module.exports = {
+  OpenAIProxyError,
+  sendOpenAIError,
+  isInvalidJsonBodyError,
+  normalizeUpstreamOpenAIError,
+};
```

---

### 2) Add a global JSON error handler

This ensures invalid JSON doesn’t result in an HTML error response and that unexpected exceptions become OpenAI-style JSON.

**`src/middleware/errorHandler.js`** (new)

```diff
diff --git a/src/middleware/errorHandler.js b/src/middleware/errorHandler.js
new file mode 100644
--- /dev/null
+++ b/src/middleware/errorHandler.js
@@
+const {
+  OpenAIProxyError,
+  sendOpenAIError,
+  isInvalidJsonBodyError,
+  normalizeUpstreamOpenAIError,
+} = require("../errors");
+
+/**
+ * Express error-handling middleware.
+ * Must be registered AFTER all routes.
+ */
+function errorHandler(err, req, res, next) {
+  // If streaming already started, we cannot reliably send JSON. Just end.
+  if (res.headersSent) {
+    try {
+      res.end();
+    } catch (_) {
+      // ignore
+    }
+    return;
+  }
+
+  // Invalid JSON request body
+  if (isInvalidJsonBodyError(err)) {
+    // Mirrors OpenAI’s typical wording, but keeps it short and unambiguous.
+    return sendOpenAIError(res, 400, "We could not parse the JSON body of your request.", {
+      type: "invalid_request_error",
+      param: null,
+      code: null,
+    });
+  }
+
+  // Our own validation / proxy errors
+  if (err instanceof OpenAIProxyError) {
+    return sendOpenAIError(res, err.status, err.message, {
+      type: err.type,
+      param: err.param,
+      code: err.code,
+    });
+  }
+
+  // Upstream OpenAI-shaped error (e.g., thrown by Codex CLI wrapper)
+  const upstream = normalizeUpstreamOpenAIError(err);
+  if (upstream) {
+    return res.status(upstream.status).json(upstream.body);
+  }
+
+  // Fallback
+  return sendOpenAIError(res, 500, "The server had an error processing your request.", {
+    type: "server_error",
+    param: null,
+    code: null,
+  });
+}
+
+module.exports = { errorHandler };
```

---

### 3) Validation middleware (chat + legacy completions)

**`src/middleware/validateCompletionsRequests.js`** (new)

```diff
diff --git a/src/middleware/validateCompletionsRequests.js b/src/middleware/validateCompletionsRequests.js
new file mode 100644
--- /dev/null
+++ b/src/middleware/validateCompletionsRequests.js
@@
+const { OpenAIProxyError } = require("../errors");
+
+function isPlainObject(v) {
+  return v !== null && typeof v === "object" && !Array.isArray(v);
+}
+
+function parseNonNegativeInt(value) {
+  if (value == null) return 0;
+  const n = Number(value);
+  if (!Number.isFinite(n)) return 0;
+  const i = Math.floor(n);
+  return i < 0 ? 0 : i;
+}
+
+// Very cheap token estimate; bounded by express.json body size.
+// We use "approximately" in messages where relevant.
+function estimateTokensFromText(text) {
+  if (typeof text !== "string" || text.length === 0) return 0;
+  return Math.ceil(text.length / 4);
+}
+
+function estimateTokensFromChatMessages(messages) {
+  let total = 0;
+  for (const m of messages) {
+    if (!isPlainObject(m)) continue;
+    const c = m.content;
+    if (typeof c === "string") {
+      total += estimateTokensFromText(c);
+      continue;
+    }
+    // If content is structured (multimodal), count any text parts conservatively.
+    if (Array.isArray(c)) {
+      for (const part of c) {
+        if (typeof part === "string") {
+          total += estimateTokensFromText(part);
+        } else if (isPlainObject(part) && typeof part.text === "string") {
+          total += estimateTokensFromText(part.text);
+        }
+      }
+    }
+  }
+  return total;
+}
+
+function estimateTokensFromPrompt(prompt) {
+  if (typeof prompt === "string") return estimateTokensFromText(prompt);
+  if (Array.isArray(prompt)) {
+    let total = 0;
+    for (const p of prompt) {
+      if (typeof p === "string") total += estimateTokensFromText(p);
+    }
+    return total;
+  }
+  return 0;
+}
+
+function requireField(body, field) {
+  if (body[field] == null) {
+    throw new OpenAIProxyError(400, `Missing required parameter: '${field}'.`, {
+      type: "invalid_request_error",
+      param: field,
+      code: "missing_required_parameter",
+    });
+  }
+}
+
+function requireString(body, field) {
+  requireField(body, field);
+  if (typeof body[field] !== "string") {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid type for '${field}': expected a string, but got ${typeof body[field]} instead.`,
+      { type: "invalid_request_error", param: field, code: "invalid_type" },
+    );
+  }
+}
+
+function validateN(body, maxChoices) {
+  const rawN = body.n ?? 1;
+  if (typeof rawN !== "number" || !Number.isInteger(rawN) || rawN < 1) {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid value for 'n': expected a positive integer, but got ${JSON.stringify(rawN)}.`,
+      { type: "invalid_request_error", param: "n", code: "invalid_value" },
+    );
+  }
+  if (maxChoices > 0 && rawN > maxChoices) {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid value for 'n': must be <= ${maxChoices}.`,
+      { type: "invalid_request_error", param: "n", code: "invalid_value" },
+    );
+  }
+}
+
+function validateStreamFlag(body) {
+  if (Object.prototype.hasOwnProperty.call(body, "stream") && typeof body.stream !== "boolean") {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid type for 'stream': expected a boolean, but got ${typeof body.stream} instead.`,
+      { type: "invalid_request_error", param: "stream", code: "invalid_type" },
+    );
+  }
+}
+
+function enforcePromptTokenLimit(estimated, maxTokens, paramName) {
+  if (maxTokens > 0 && estimated > maxTokens) {
+    throw new OpenAIProxyError(
+      400,
+      `This proxy's maximum prompt length is ${maxTokens} tokens, but you sent approximately ${estimated} tokens. Please reduce the length of the prompt/messages and try again.`,
+      { type: "invalid_request_error", param: paramName, code: "context_length_exceeded" },
+    );
+  }
+}
+
+function validateChatCompletionsRequest(req, _res, next) {
+  const body = req.body;
+  if (!isPlainObject(body)) {
+    throw new OpenAIProxyError(400, "Invalid request body: expected a JSON object.", {
+      type: "invalid_request_error",
+      param: null,
+      code: "invalid_request",
+    });
+  }
+
+  requireString(body, "model");
+  requireField(body, "messages");
+  if (!Array.isArray(body.messages)) {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid type for 'messages': expected an array of objects, but got ${typeof body.messages} instead.`,
+      { type: "invalid_request_error", param: "messages", code: "invalid_type" },
+    );
+  }
+  if (body.messages.length === 0) {
+    throw new OpenAIProxyError(400, "Invalid value for 'messages': must not be empty.", {
+      type: "invalid_request_error",
+      param: "messages",
+      code: "invalid_value",
+    });
+  }
+  for (let i = 0; i < body.messages.length; i++) {
+    const m = body.messages[i];
+    if (!isPlainObject(m)) {
+      throw new OpenAIProxyError(
+        400,
+        `Invalid type for 'messages[${i}]': expected an object.`,
+        { type: "invalid_request_error", param: `messages[${i}]`, code: "invalid_type" },
+      );
+    }
+    if (typeof m.role !== "string") {
+      throw new OpenAIProxyError(
+        400,
+        `Invalid type for 'messages[${i}].role': expected a string.`,
+        { type: "invalid_request_error", param: `messages[${i}].role`, code: "invalid_type" },
+      );
+    }
+    // Don't over-validate content shape; just ensure it won't crash downstream if assumed string-ish.
+    // If your Codex CLI strictly requires string content, uncomment this stricter check:
+    // if (typeof m.content !== "string") { ... }
+  }
+
+  validateStreamFlag(body);
+
+  const maxChoices = parseNonNegativeInt(process.env.PROXY_MAX_CHAT_CHOICES);
+  validateN(body, maxChoices);
+
+  const maxPromptTokens = parseNonNegativeInt(process.env.PROXY_MAX_PROMPT_TOKENS);
+  if (maxPromptTokens > 0) {
+    const estimated = estimateTokensFromChatMessages(body.messages);
+    enforcePromptTokenLimit(estimated, maxPromptTokens, "messages");
+  }
+
+  return next();
+}
+
+function validateLegacyCompletionsRequest(req, _res, next) {
+  const body = req.body;
+  if (!isPlainObject(body)) {
+    throw new OpenAIProxyError(400, "Invalid request body: expected a JSON object.", {
+      type: "invalid_request_error",
+      param: null,
+      code: "invalid_request",
+    });
+  }
+
+  requireString(body, "model");
+  requireField(body, "prompt");
+  const prompt = body.prompt;
+  if (!(typeof prompt === "string" || (Array.isArray(prompt) && prompt.every((p) => typeof p === "string")))) {
+    throw new OpenAIProxyError(
+      400,
+      `Invalid type for 'prompt': expected a string or array of strings.`,
+      { type: "invalid_request_error", param: "prompt", code: "invalid_type" },
+    );
+  }
+
+  validateStreamFlag(body);
+
+  // `n` exists on legacy completions too; reuse the same env var if present.
+  const maxChoices = parseNonNegativeInt(process.env.PROXY_MAX_CHAT_CHOICES);
+  validateN(body, maxChoices);
+
+  const maxPromptTokens = parseNonNegativeInt(process.env.PROXY_MAX_PROMPT_TOKENS);
+  if (maxPromptTokens > 0) {
+    const estimated = estimateTokensFromPrompt(prompt);
+    enforcePromptTokenLimit(estimated, maxPromptTokens, "prompt");
+  }
+
+  return next();
+}
+
+module.exports = {
+  validateChatCompletionsRequest,
+  validateLegacyCompletionsRequest,
+  // exported for unit tests if desired
+  _internal: {
+    estimateTokensFromText,
+    estimateTokensFromChatMessages,
+    estimateTokensFromPrompt,
+  },
+};
```

**Key notes:**

- Validation is **sync** and cheap.
- Token estimation is intentionally simple; the error message uses “approximately”.
- If you know Codex CLI requires `content: string`, uncomment the stricter content check.

---

### 4) Wire middleware into the router *before* Codex CLI call

Wherever your OpenAI-compatible routes are defined, add the middleware.

Example: **`src/routes/openai.js`** (adjust to your actual router file)

```diff
diff --git a/src/routes/openai.js b/src/routes/openai.js
--- a/src/routes/openai.js
+++ b/src/routes/openai.js
@@
 const express = require("express");
 const router = express.Router();
 
 const chatCompletionsHandler = require("../handlers/chat/completions");
 const legacyCompletionsHandler = require("../handlers/completions");
+const {
+  validateChatCompletionsRequest,
+  validateLegacyCompletionsRequest,
+} = require("../middleware/validateCompletionsRequests");
 
-router.post("/v1/chat/completions", chatCompletionsHandler);
-router.post("/v1/completions", legacyCompletionsHandler);
+router.post("/v1/chat/completions", validateChatCompletionsRequest, chatCompletionsHandler);
+router.post("/v1/completions", validateLegacyCompletionsRequest, legacyCompletionsHandler);
 
 module.exports = router;
```

This guarantees validation happens **before** any streaming headers or Codex CLI invocation.

---

### 5) Ensure express.json is 16mb and register the error handler

Example: **`src/server.js`** (or wherever you configure Express)

```diff
diff --git a/src/server.js b/src/server.js
--- a/src/server.js
+++ b/src/server.js
@@
 const express = require("express");
 const app = express();
 
-app.use(express.json());
+app.use(express.json({ limit: "16mb" }));
 
 const openaiRoutes = require("./routes/openai");
 app.use(openaiRoutes);
 
+const { errorHandler } = require("./middleware/errorHandler");
+app.use(errorHandler);
+
 module.exports = app;
```

---

### 6) Catch Codex CLI exceptions and avoid hanging/HTML errors

Update your chat handler to pass errors to the error middleware and to safely terminate if streaming has started.

**`src/handlers/chat/completions.js`** (example pattern; fit into your existing logic)

```diff
diff --git a/src/handlers/chat/completions.js b/src/handlers/chat/completions.js
--- a/src/handlers/chat/completions.js
+++ b/src/handlers/chat/completions.js
@@
+const { normalizeUpstreamOpenAIError } = require("../../errors");
 const codex = require("../../services/codexCli"); // adjust to your actual Codex CLI wrapper
 
 module.exports = async function chatCompletionsHandler(req, res, next) {
-  // existing logic...
+  try {
+    const body = req.body;
+    const stream = body.stream === true;
+
+    if (stream) {
+      // IMPORTANT: validation already ran, so only runtime errors remain.
+      // Preserve your existing SSE relay implementation here.
+      return await codex.chatCompletionsStream(body, res);
+    }
+
+    const result = await codex.chatCompletions(body);
+    return res.json(result);
+  } catch (err) {
+    // If Codex CLI wrapper already gave us an OpenAI-shaped error, pass it through.
+    const upstream = normalizeUpstreamOpenAIError(err);
+    if (upstream && !res.headersSent) {
+      return res.status(upstream.status).json(upstream.body);
+    }
+
+    // If streaming already started, just end; don't let Express emit HTML.
+    if (res.headersSent) {
+      try { res.end(); } catch (_) {}
+      return;
+    }
+
+    return next(err);
+  }
 };
```

Apply the same pattern to the legacy completions handler.

---

## Tests

Below are Jest + Supertest tests. If you’re using Vitest/Mocha, the assertions and structure are trivial to port.

### 1) Validation tests

**`test/completions.validation.test.js`** (new)

```diff
diff --git a/test/completions.validation.test.js b/test/completions.validation.test.js
new file mode 100644
--- /dev/null
+++ b/test/completions.validation.test.js
@@
+const request = require("supertest");
+
+// IMPORTANT: import the Express app without starting a listener.
+// Adjust path if your app export differs.
+const app = require("../src/server");
+
+describe("OpenAI-compatible request validation", () => {
+  const VALID_MESSAGES = [{ role: "user", content: "hello" }];
+
+  beforeEach(() => {
+    delete process.env.PROXY_MAX_PROMPT_TOKENS;
+    delete process.env.PROXY_MAX_CHAT_CHOICES;
+  });
+
+  test("POST /v1/chat/completions missing messages -> 400 OpenAI-style error", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5" })
+      .expect(400);
+
+    expect(res.body).toHaveProperty("error");
+    expect(res.body.error.type).toBe("invalid_request_error");
+    expect(res.body.error.param).toBe("messages");
+    expect(res.body.error.code).toBe("missing_required_parameter");
+    expect(res.body.error.message).toMatch(/Missing required parameter: 'messages'\./);
+  });
+
+  test("POST /v1/chat/completions invalid messages type -> 400", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5", messages: "nope" })
+      .expect(400);
+
+    expect(res.body.error.code).toBe("invalid_type");
+    expect(res.body.error.param).toBe("messages");
+  });
+
+  test("POST /v1/chat/completions missing model -> 400", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ messages: VALID_MESSAGES })
+      .expect(400);
+
+    expect(res.body.error.code).toBe("missing_required_parameter");
+    expect(res.body.error.param).toBe("model");
+  });
+
+  test("invalid JSON -> 400 JSON error body (no HTML)", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .set("Content-Type", "application/json")
+      .send("{ this is not json")
+      .expect(400);
+
+    expect(res.headers["content-type"]).toMatch(/application\/json/i);
+    expect(res.body).toHaveProperty("error");
+    expect(res.body.error.type).toBe("invalid_request_error");
+    expect(res.body.error.message).toMatch(/could not parse the JSON/i);
+  });
+
+  test("stream=true invalid request returns normal JSON error and does not start SSE", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5", stream: true }) // missing messages
+      .expect(400);
+
+    expect(res.headers["content-type"]).toMatch(/application\/json/i);
+    expect(res.headers["content-type"]).not.toMatch(/text\/event-stream/i);
+  });
+
+  test("enforces PROXY_MAX_CHAT_CHOICES", async () => {
+    process.env.PROXY_MAX_CHAT_CHOICES = "1";
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5", messages: VALID_MESSAGES, n: 2 })
+      .expect(400);
+
+    expect(res.body.error.param).toBe("n");
+    expect(res.body.error.code).toBe("invalid_value");
+  });
+
+  test("enforces PROXY_MAX_PROMPT_TOKENS (chat)", async () => {
+    process.env.PROXY_MAX_PROMPT_TOKENS = "1";
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5", messages: VALID_MESSAGES })
+      .expect(400);
+
+    expect(res.body.error.code).toBe("context_length_exceeded");
+    expect(res.body.error.param).toBe("messages");
+  });
+
+  test("legacy /v1/completions missing prompt -> 400", async () => {
+    const res = await request(app)
+      .post("/v1/completions")
+      .send({ model: "gpt-5" })
+      .expect(400);
+
+    expect(res.body.error.param).toBe("prompt");
+    expect(res.body.error.code).toBe("missing_required_parameter");
+  });
+});
```

---

### 2) Integration test: simulate Codex CLI failure -> clean JSON 500

This assumes your Codex wrapper is imported from `src/services/codexCli`. If it’s different, adjust the mock path.

**`test/codexCli.failure.test.js`** (new)

```diff
diff --git a/test/codexCli.failure.test.js b/test/codexCli.failure.test.js
new file mode 100644
--- /dev/null
+++ b/test/codexCli.failure.test.js
@@
+const request = require("supertest");
+
+jest.mock("../src/services/codexCli", () => ({
+  chatCompletions: async () => {
+    throw new Error("simulated codex cli failure");
+  },
+  chatCompletionsStream: async () => {
+    throw new Error("simulated codex cli failure");
+  },
+}));
+
+const app = require("../src/server");
+
+describe("Codex CLI failure handling", () => {
+  test("non-stream: returns JSON 500 server_error", async () => {
+    const res = await request(app)
+      .post("/v1/chat/completions")
+      .send({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] })
+      .expect(500);
+
+    expect(res.headers["content-type"]).toMatch(/application\/json/i);
+    expect(res.body).toHaveProperty("error");
+    expect(res.body.error.type).toBe("server_error");
+  });
+});
```

---

## Documentation update

If you have a config/README doc section, add a short note.

**`README.md`** (or `docs/config.md`)

```diff
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@
+## Proxy input limits (optional)
+
+The proxy can enforce lightweight request limits before invoking Codex CLI:
+
+- `PROXY_MAX_PROMPT_TOKENS` (default: 0 = unlimited)
+  - Rejects requests whose prompt/messages exceed this approximate token budget (HTTP 400).
+- `PROXY_MAX_CHAT_CHOICES` (default: 0 = unlimited)
+  - Rejects requests with `n` greater than this value (HTTP 400).
+
+Errors are returned in an OpenAI-compatible JSON format:
+`{ "error": { "message": "...", "type": "...", "param": "...", "code": "..." } }`
```

---

## Notes on spec alignment and safety

- Error format matches OpenAI-style structure: `error: { message, type, param, code }`.
- Invalid JSON returns **400** and a JSON body, avoiding HTML error pages.
- Validation runs **before** any streaming headers and **before** Codex CLI invocation.

---

## What to verify locally

1. Run the full suite (`npm test` / `pnpm test` as applicable).
2. Confirm streaming behavior:
   - Valid stream requests still get SSE.
   - Invalid stream requests return **400 JSON** and **no SSE**.
3. Confirm golden transcript tests aren’t impacted:
   - Only invalid requests should change behavior; valid requests pass through unchanged.
