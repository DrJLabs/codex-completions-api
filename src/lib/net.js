export function normalizeIp(ip = "") {
  if (!ip) return "";
  return String(ip).replace("::ffff:", "");
}

export function isLoopbackAddress(ip = "") {
  const normalized = normalizeIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function isLoopbackRequest(req = {}) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return isLoopbackAddress(ip);
}
