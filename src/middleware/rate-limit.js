// Simple in-memory token-bucket rate limiter keyed by API key (fallback IP).
// Not distributed; intended as defense-in-depth in front of edge rate limiting.

const buckets = new Map();

export default function rateLimit(options = {}) {
  const enabled = String(options.enabled ?? "false").toLowerCase() === "true";
  const windowMs = Number(options.windowMs ?? 60_000);
  const max = Number(options.max ?? 60);

  return function rateLimitMiddleware(req, res, next) {
    if (!enabled) return next();
    if (req.method !== "POST") return next();
    const path = req.path || req.originalUrl || "";
    if (path !== "/v1/chat/completions" && path !== "/v1/completions") return next();

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const key = token || req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.startedAt >= windowMs) {
      b = { startedAt: now, count: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader("Retry-After", Math.ceil((b.startedAt + windowMs - now) / 1000));
      return res.status(429).json({
        error: {
          message: "rate limit exceeded",
          type: "rate_limit_error",
          code: "rate_limited",
        },
      });
    }
    next();
  };
}
