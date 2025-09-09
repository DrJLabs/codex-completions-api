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
  ]
) => {
  const raw = String(name || "").trim();
  if (!raw) return { requested: "codex-5", effective: defaultModel };
  const lower = raw.toLowerCase();
  if (lower === "codex-5") return { requested: "codex-5", effective: defaultModel };
  if (publicIds.includes(lower)) return { requested: lower, effective: defaultModel };
  return { requested: raw, effective: raw };
};

// CORS application as a pure function using request origin and enabled flag.
export const applyCors = (req, res, enabled = true) => {
  if (!enabled) return;
  const origin = req?.headers?.origin;
  if (origin) {
    res.setHeader?.("Access-Control-Allow-Origin", origin);
    res.setHeader?.("Vary", "Origin");
    res.setHeader?.("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader?.("Access-Control-Allow-Origin", "*");
  }
  res.setHeader?.("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader?.("Access-Control-Max-Age", "600");
};
