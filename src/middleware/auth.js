import { config as CFG } from "../config/index.js";
import { authErrorBody } from "../lib/errors.js";
import { isLoopbackRequest } from "../lib/net.js";

const bearerToken = (req) => {
  const auth = req.headers.authorization || "";
  if (typeof auth !== "string") return "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
};

const hasValidApiKey = (req) => {
  const token = bearerToken(req);
  return Boolean(token) && token === CFG.API_KEY;
};

export function requireStrictAuth(req, res, next) {
  if (!hasValidApiKey(req)) {
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  return next();
}

export function requireUsageAuth(req, res, next) {
  if (CFG.PROXY_USAGE_ALLOW_UNAUTH) return next();
  return requireStrictAuth(req, res, next);
}

// Back-compat alias (deprecated name).
export const requireApiKey = requireUsageAuth;

export function requireTestAuth(req, res, next) {
  if (!hasValidApiKey(req)) {
    return res.status(401).set("WWW-Authenticate", "Bearer realm=api").json(authErrorBody());
  }
  if (!CFG.PROXY_TEST_ALLOW_REMOTE && !isLoopbackRequest(req)) {
    return res.status(403).json({ ok: false, reason: "test endpoints restricted to loopback" });
  }
  return next();
}
