import { nanoid } from "nanoid";
import { logStructured } from "../services/logging/schema.js";
import { ensureCopilotTraceContext } from "../lib/trace-ids.js";
import { detectCopilotRequest } from "../lib/copilot-detect.js";

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
    const detection = detectCopilotRequest({ headers: req.headers });
    res.locals.copilot_detected = detection.copilot_detected;
    res.locals.copilot_detect_tier = detection.copilot_detect_tier;
    res.locals.copilot_detect_reasons = detection.copilot_detect_reasons;
    const trace_id = res.locals.trace_id;
    res.on("finish", () => {
      try {
        const dur_ms = Date.now() - started;
        const ua = req.headers["user-agent"] || "";
        const auth = req.headers.authorization ? "present" : "none";
        const detectLocals = res.locals || {};
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
            copilot_detected: detectLocals.copilot_detected ?? false,
            copilot_detect_tier: detectLocals.copilot_detect_tier ?? null,
            copilot_detect_reasons: detectLocals.copilot_detect_reasons ?? [],
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
