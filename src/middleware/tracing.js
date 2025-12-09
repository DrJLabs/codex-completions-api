import { context } from "@opentelemetry/api";
import { startHttpSpan } from "../services/tracing.js";

export default function tracingMiddleware() {
  return (req, res, next) => {
    const spanInfo = startHttpSpan(req);
    if (!spanInfo) return next();
    const { span, context: ctx } = spanInfo;
    res.locals = res.locals || {};
    const spanCtx = span.spanContext();
    res.locals.trace_span = span;
    res.locals.trace_id = spanCtx.traceId;
    res.locals.span_id = spanCtx.spanId;
    const endSpan = () => {
      try {
        span.setAttribute("http.status_code", res.statusCode);
        span.end();
      } catch {}
    };
    res.on("finish", endSpan);
    res.on("close", () => {
      if (span && typeof span.end === "function") {
        try {
          span.end();
        } catch {}
      }
    });
    context.with(ctx, next);
  };
}
