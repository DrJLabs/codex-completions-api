import { nanoid } from "nanoid";

export default function accessLog() {
  return function accessLogMiddleware(req, res, next) {
    const req_id = nanoid();
    const started = Date.now();
    res.setHeader?.("X-Request-Id", req_id);
    res.locals = res.locals || {};
    res.locals.req_id = req_id;
    res.on("finish", () => {
      try {
        const dur_ms = Date.now() - started;
        const ua = req.headers["user-agent"] || "";
        const auth = req.headers.authorization ? "present" : "none";
        const entry = {
          ts: Date.now(),
          level: "info",
          req_id,
          method: req.method,
          route: req.originalUrl,
          status: res.statusCode,
          dur_ms,
          ua,
          auth,
          kind: "access",
        };
        // JSON line for easy ingestion
        console.log(JSON.stringify(entry));
      } catch {}
    });
    next();
  };
}
