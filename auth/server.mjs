import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const REALM = process.env.AUTH_REALM || "api";
const SECRET = process.env.PROXY_API_KEY || "";

const buildCors = (req) => {
  const origin = req.headers["origin"];
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  headers["Access-Control-Allow-Methods"] = "GET, POST, HEAD, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
};

const sendJSON = (req, res, status, data, extraHeaders = {}) => {
  const base = buildCors(req);
  res.writeHead(status, { ...base, ...extraHeaders });
  res.end(JSON.stringify(data));
};

const unauthorized = (req, res, message = "unauthorized") => {
  sendJSON(req, res, 401, { error: { message } }, { "WWW-Authenticate": `Bearer realm=${REALM}` });
};

const server = http.createServer((req, res) => {
  const { url = "", headers = {}, method = "GET" } = req;
  if (url === "/healthz") {
    return sendJSON(req, res, 200, { ok: true });
  }
  if (url.startsWith("/verify")) {
    if (method === "OPTIONS") {
      // Always allow CORS preflight to succeed so Traefik can forward to app
      return sendJSON(req, res, 204, { ok: true });
    }
    const auth = headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!SECRET) return unauthorized(req, res, "server misconfigured");
    if (!token || token !== SECRET) return unauthorized(req, res, "invalid token");
    return sendJSON(req, res, 200, { ok: true });
  }
  sendJSON(req, res, 404, { error: { message: "not found" } });
});

server.listen(PORT, () => {
  console.log(`[auth] listening on :${PORT}`);
});
