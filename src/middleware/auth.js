import { config as CFG } from "../config/index.js";
import { authErrorBody } from "../lib/errors.js";
import { isLoopbackRequest } from "../lib/net.js";

const hasValidApiKey = (req) => {
  const auth = req.headers.authorization || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  return Boolean(token) && token === CFG.API_KEY;
};

export function requireApiKey(req, res, next) {
  if (CFG.PROXY_USAGE_ALLOW_UNAUTH) return next();
  if (!hasValidApiKey(req)) {
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  return next();
}

export function requireTestAuth(req, res, next) {
  if (!hasValidApiKey(req)) {
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  if (!CFG.PROXY_TEST_ALLOW_REMOTE && !isLoopbackRequest(req)) {
    return res.status(403).json({ ok: false, reason: "test endpoints restricted to loopback" });
  }
  return next();
}
