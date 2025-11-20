import { observeHttpRequest } from "../services/metrics/index.js";

const hrtimeMs = () => {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1000 + nanoseconds / 1e6;
};

export default function metricsMiddleware() {
  return (req, res, next) => {
    const startMs = hrtimeMs();
    res.on("finish", () => {
      const durationMs = hrtimeMs() - startMs;
      const route =
        (req.route && req.route.path) || (req.baseUrl ? req.baseUrl : req.originalUrl || "");
      const model =
        typeof req.body?.model === "string"
          ? req.body.model
          : typeof req.query?.model === "string"
            ? req.query.model
            : undefined;

      observeHttpRequest({
        route,
        method: req.method,
        statusCode: res.statusCode,
        model,
        durationMs,
      });
    });
    next();
  };
}
