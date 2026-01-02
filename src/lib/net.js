export function normalizeIp(ip = "") {
  if (!ip) return "";
  return String(ip).replace("::ffff:", "");
}

export function getClientIp(req = {}) {
  if (!req) return "";
  const ip = req.ip || req.connection?.remoteAddress || "";
  return normalizeIp(ip);
}

export function isLoopbackAddress(ip = "") {
  const normalized = normalizeIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function isLoopbackRequest(req = {}) {
  const ip = getClientIp(req);
  return isLoopbackAddress(ip);
}
