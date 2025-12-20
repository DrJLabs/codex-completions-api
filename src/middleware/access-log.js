import { nanoid } from "nanoid";
import { logStructured } from "../services/logging/schema.js";
import { ensureCopilotTraceContext } from "../lib/trace-ids.js";

export default function accessLog() {
  return function accessLogMiddleware(req, res, next) {
    const req_id = nanoid();
    const started = Date.now();
    const { id: copilot_trace_id, source, header } = ensureCopilotTraceContext(req, res);
    res.setHeader?.("X-Request-Id", req_id);
    res.locals = res.locals || {};
    res.locals.req_id = req_id;
    res.locals.copilot_trace_id = copilot_trace_id;
    res.locals.copilot_trace_source = source;
    res.locals.copilot_trace_header = header;
    const trace_id = res.locals.trace_id;
    res.on("finish", () => {
      try {
        const dur_ms = Date.now() - started;
        const ua = req.headers["user-agent"] || "";
        const auth = req.headers.authorization ? "present" : "none";
        logStructured(
          {
            component: "http",
            event: "access_log",
            req_id,
            trace_id,
            route: req.originalUrl,
            level: "info",
            latency_ms: dur_ms,
            ts_ms: started,
          },
          {
            copilot_trace_id,
            copilot_trace_source: source,
            copilot_trace_header: header,
            method: req.method,
            status: res.statusCode,
            ua,
            auth,
            kind: "access",
            dur_ms: dur_ms,
          }
        );
      } catch (err) {
        try {
          logStructured(
            { component: "http", event: "access_log_error", level: "error" },
            { message: err?.message || String(err) }
          );
        } catch {}
      }
    });
    next();
  };
}
