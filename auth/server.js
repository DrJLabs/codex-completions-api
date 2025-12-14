import http from "node:http";
import { bearerTokenFromAuthHeader } from "../src/lib/bearer.js";

const PORT = Number(process.env.PORT || 8080);
const REALM = process.env.AUTH_REALM || "api";
const SECRET = process.env.PROXY_API_KEY || "";

// Deprecated: use auth/server.mjs. This file is kept only for legacy builds
// and will exit unless ALLOW_LEGACY_AUTH=true is explicitly set.
if (process.env.ALLOW_LEGACY_AUTH !== "true") {
  console.error(
    "[auth] auth/server.js is deprecated; use auth/server.mjs instead (set ALLOW_LEGACY_AUTH=true to override)."
  );
  process.exit(1);
}

const sendJSON = (res, status, data, extraHeaders = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(data));
};

const unauthorized = (res, message = "unauthorized") => {
  sendJSON(res, 401, { error: { message } }, { "WWW-Authenticate": `Bearer realm=${REALM}` });
};

const server = http.createServer((req, res) => {
  const { url = "", headers = {} } = req;
  if (url === "/healthz") {
    return sendJSON(res, 200, { ok: true });
  }
  if (url.startsWith("/verify")) {
    const token = bearerTokenFromAuthHeader(headers["authorization"] || "");
    if (!SECRET) return unauthorized(res, "server misconfigured");
    if (!token || token !== SECRET) return unauthorized(res, "invalid token");
    return sendJSON(res, 200, { ok: true });
  }
  sendJSON(res, 404, { error: { message: "not found" } });
});

server.listen(PORT, () => {
  console.log(`[auth] listening on :${PORT}`);
});
