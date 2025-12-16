import { MODEL_TARGET_OVERRIDES, MODEL_REASONING_OVERRIDES } from "./config/models.js";

// Pure utilities extracted from server.js for unit testing
// ESM module

export const stripAnsi = (s = "") => String(s).replace(/\x1B\[[0-?]*[ -/]*[@-~]|\r|\u0008/g, "");

export const toStringContent = (c) => {
  if (typeof c === "string") return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
};

export const joinMessages = (messages = []) =>
  (messages || []).map((m) => `[${m?.role || "user"}] ${toStringContent(m?.content)}`).join("\n");

export const estTokens = (s = "") => Math.ceil(String(s).length / 4);

export const estTokensForMessages = (msgs = []) => {
  let chars = 0;
  for (const m of msgs || []) {
    if (!m) continue;
    const c = m.content;
    if (Array.isArray(c))
      chars += c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("").length;
    else chars += String(c || "").length;
  }
  return Math.ceil(chars / 4);
};

export const parseTime = (v) => {
  if (v === 0 || v === "0") return 0;
  if (!v && v !== 0) return 0;
  if (/^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

export const aggregateUsage = (events = [], start = 0, end = Date.now() + 1, group = "") => {
  const filtered = (events || []).filter((e) => (e?.ts || 0) >= start && (e?.ts || 0) < end);
  const agg = {
    total_requests: 0,
    prompt_tokens_est: 0,
    completion_tokens_est: 0,
    total_tokens_est: 0,
  };
  const buckets = {};
  for (const e of filtered) {
    agg.total_requests += 1;
    agg.prompt_tokens_est += e.prompt_tokens_est || 0;
    agg.completion_tokens_est += e.completion_tokens_est || 0;
    agg.total_tokens_est += e.total_tokens_est || 0;
    if (group === "hour" || group === "day") {
      const d = new Date(e.ts || 0);
      const key =
        group === "hour"
          ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).toISOString()
          : new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      // Keys are ISO timestamps derived from Date; safe for object index.
      // eslint-disable-next-line security/detect-object-injection
      buckets[key] ||= {
        ts: key,
        requests: 0,
        prompt_tokens_est: 0,
        completion_tokens_est: 0,
        total_tokens_est: 0,
      };
      // eslint-disable-next-line security/detect-object-injection
      const b = buckets[key];
      b.requests += 1;
      b.prompt_tokens_est += e.prompt_tokens_est || 0;
      b.completion_tokens_est += e.completion_tokens_est || 0;
      b.total_tokens_est += e.total_tokens_est || 0;
    }
  }
  const out = { start, end, group: group || undefined, ...agg };
  if (group === "hour" || group === "day")
    out.buckets = Object.values(buckets).sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
};

export const isModelText = (line) => {
  const l = String(line || "").trim();
  if (!l) return false;
  if (/^(diff --git|\+\+\+ |--- |@@ )/.test(l)) return false; // diff headers
  if (/^\*\*\* (Begin|End) Patch/.test(l)) return false; // apply_patch envelopes
  if (
    /^(running:|command:|applying patch|reverted|workspace|approval|sandbox|tool:|mcp:|file:|path:)/i.test(
      l
    )
  )
    return false; // runner logs
  if (/^\[\d{4}-\d{2}-\d{2}T/.test(l)) return false; // timestamped log lines
  if (/^[-]{6,}$/.test(l)) return false; // separators
  if (
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|tokens used):/i.test(
      l
    )
  )
    return false;
  if (/^user instructions:/i.test(l)) return false;
  if (/^codex$/i.test(l)) return false;
  return true;
};

export const impliedEffortForModel = (requestedModel) => {
  const m = String(requestedModel || "").toLowerCase();
  if (MODEL_REASONING_OVERRIDES.has(m)) {
    return MODEL_REASONING_OVERRIDES.get(m) || "";
  }
  const variants = ["low", "medium", "high", "minimal"];
  for (const v of variants) {
    if (m === `codex-5-${v}` || m === `codev-5-${v}`) return v;
  }
  return "";
};

export const normalizeModel = (
  name,
  defaultModel = "gpt-5",
  publicIds = [
    "codex-5",
    "codex-5-low",
    "codex-5-medium",
    "codex-5-high",
    "codex-5-minimal",
    "codev-5",
    "codev-5-low",
    "codev-5-medium",
    "codev-5-high",
    "codev-5-minimal",
    "codev-5.1-l",
    "codev-5.1-m",
    "codev-5.1-h",
    "codev-5.2-l",
    "codev-5.2-m",
    "codev-5.2-h",
    "codev-5.2-xh",
    "gpt-5.2-codev-l",
    "gpt-5.2-codev-m",
    "gpt-5.2-codev-h",
    "gpt-5.2-codev-xh",
    "gpt-5.2-l",
    "gpt-5.2-m",
    "gpt-5.2-h",
    "gpt-5.2-xh",
  ]
) => {
  const raw = String(name || "").trim();
  if (!raw) return { requested: "codex-5", effective: defaultModel };
  const lower = raw.toLowerCase();
  const overrideTarget = MODEL_TARGET_OVERRIDES.get(lower);
  const effective = overrideTarget || defaultModel;
  if (lower === "codex-5") return { requested: "codex-5", effective };
  const normalizedIds = (() => {
    if (!publicIds) return new Set();
    if (publicIds instanceof Set)
      return new Set(Array.from(publicIds, (value) => String(value).toLowerCase()));
    if (Array.isArray(publicIds))
      return new Set(publicIds.map((value) => String(value).toLowerCase()));
    return new Set([String(publicIds).toLowerCase()]);
  })();
  if (normalizedIds.has(lower)) return { requested: lower, effective };
  return { requested: raw, effective: raw };
};

// CORS application as a pure function using request origin and enabled flag.
const stripTrailingSlashes = (value) => value.replace(/\/+$/, "");

const normalizeOriginForMatch = (value = "") => {
  const input = String(value || "")
    .trim()
    .toLowerCase();
  if (!input) return "";

  const trimmed = stripTrailingSlashes(input);

  const canonicalCustomSchemes = [
    { scheme: "capacitor", host: "localhost" },
    { scheme: "app", host: "obsidian.md" },
  ];

  for (const { scheme, host } of canonicalCustomSchemes) {
    const prefix = `${scheme}://`;
    if (!trimmed.startsWith(prefix)) continue;

    const withoutScheme = trimmed.slice(prefix.length);
    const authority = withoutScheme.split("/")[0];
    const [hostname] = authority.split(":");

    if (hostname === host) {
      return `${scheme}://${host}`;
    }

    // Custom scheme that we do not recognize exactly – keep the original
    // string so it cannot masquerade as an allowlisted origin by prefix.
    return trimmed;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const { protocol, hostname, port } = parsed;

  if (!protocol || !hostname) return trimmed;

  if (
    (protocol === "http:" || protocol === "https:") &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  ) {
    return `${protocol}//${hostname}`;
  }

  return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
};

export const applyCors = (req, res, enabled = true, allowedOrigins = "*") => {
  if (!enabled) return;

  const list = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins ?? "*")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const allowAll = list.length === 0 || list.includes("*");
  const normalized = list
    .filter((item) => item && item !== "*")
    .map((item) => normalizeOriginForMatch(item));
  const origin = req?.headers?.origin;

  const varyBase = "Access-Control-Request-Headers, Access-Control-Request-Method";
  let allowOrigin = false;

  if (origin) {
    const originKey = normalizeOriginForMatch(origin);
    if (allowAll || normalized.includes(originKey)) {
      res.setHeader?.("Access-Control-Allow-Origin", origin);
      res.setHeader?.("Access-Control-Allow-Credentials", "true");
      allowOrigin = true;
      res.setHeader?.("Vary", `Origin, ${varyBase}`);
    } else {
      res.setHeader?.("Vary", `Origin, ${varyBase}`);
    }
  } else if (allowAll) {
    res.setHeader?.("Access-Control-Allow-Origin", "*");
    res.setHeader?.("Vary", varyBase);
    allowOrigin = true;
  } else {
    res.setHeader?.("Vary", varyBase);
  }

  if (!allowOrigin) return;

  res.setHeader?.("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");

  // Allow all headers requested by the browser during preflight, falling back to a
  // superset commonly used by OpenAI-compatible clients (Stainless SDKs, Obsidian, etc.).
  const requested = (req?.headers?.["access-control-request-headers"] || "").toString().trim();
  const defaultAllowed =
    "Authorization, Content-Type, Accept, " +
    [
      // OpenAI/Stainless and common client headers
      "OpenAI-Organization",
      "OpenAI-Beta",
      "OpenAI-Version",
      "OpenAI-Project",
      "X-Requested-With",
      "X-Stainless-OS",
      "X-Stainless-Lang",
      "X-Stainless-Arch",
      "X-Stainless-Runtime",
      "X-Stainless-Runtime-Version",
      "X-Stainless-Package-Version",
      "X-Stainless-Timeout",
      "X-Stainless-Retry-Count",
      // Some clients send this to acknowledge browser usage
      "dangerously-allow-browser",
      // Internal opt-out for SSE keepalives supported by this proxy
      "X-No-Keepalive",
    ].join(", ");
  res.setHeader?.(
    "Access-Control-Allow-Headers",
    requested && requested.length ? requested : defaultAllowed
  );
  res.setHeader?.("Access-Control-Expose-Headers", "Content-Type");
  res.setHeader?.("Access-Control-Max-Age", "600");
};
