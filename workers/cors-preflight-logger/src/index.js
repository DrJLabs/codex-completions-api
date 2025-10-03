const ALLOWED = [
  "https://codex-dev.onemainarmy.com",
  "https://codex-api.onemainarmy.com",
  "app://obsidian.md",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost"
];

const DEFAULT_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
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
  "dangerously-allow-browser"
];

const NORMALIZED = ALLOWED.map((value) => value.toLowerCase());

function normalizeOrigin(origin) {
  if (!origin) return "";
  const lower = origin.toLowerCase();
  if (lower.startsWith("capacitor://localhost")) return "capacitor://localhost";
  if (lower.startsWith("app://obsidian.md")) return "app://obsidian.md";
  if (lower.startsWith("http://localhost")) return "http://localhost";
  if (lower.startsWith("https://localhost")) return "https://localhost";
  return lower;
}

function mergeAllowedHeaders(rawRequested = "") {
  const seen = new Map(DEFAULT_ALLOWED_HEADERS.map((header) => [header.toLowerCase(), header]));
  const requested = rawRequested
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const header of requested) {
    const lower = header.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, header);
    }
  }

  return Array.from(seen.values()).join(", ");
}

function buildCorsHeaders(request) {
  const origin = request.headers.get("Origin") ?? "";
  const normalized = normalizeOrigin(origin);
  const allow = normalized && NORMALIZED.includes(normalized) ? origin : "";
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers") ?? "";

  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": mergeAllowedHeaders(requestedHeaders),
    "Access-Control-Max-Age": "600",
    "Access-Control-Expose-Headers": "Content-Type",
    "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
    "X-CORS-Worker": "1"
  };

  if (allow) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function logRequest(request) {
  const origin = request.headers.get("Origin") ?? "";
  const acrMethod = request.headers.get("Access-Control-Request-Method") ?? "";
  const acrHeaders = request.headers.get("Access-Control-Request-Headers") ?? "";
  const ua = request.headers.get("User-Agent") ?? "";
  const url = new URL(request.url);
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    host: url.host,
    path: url.pathname + url.search,
    method: request.method,
    origin,
    acrMethod,
    acrHeaders,
    ua
  }));
}

export default {
  async fetch(request) {
    logRequest(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
    }

    const response = await fetch(request);
    const corsHeaders = buildCorsHeaders(request);
    const newHeaders = new Headers(response.headers);

    for (const [key, value] of Object.entries(corsHeaders)) {
      if (value) newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};
