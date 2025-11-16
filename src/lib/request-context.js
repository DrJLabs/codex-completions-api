import { nanoid } from "nanoid";

const HTTP_ROUTE_KEY = Symbol.for("codex.proxy.httpRoute");
const HTTP_MODE_KEY = Symbol.for("codex.proxy.httpMode");

export function ensureReqId(res) {
  if (res?.locals?.req_id) return res.locals.req_id;
  const id = nanoid();
  if (!res.locals) res.locals = {};
  res.locals.req_id = id;
  return id;
}

export function setHttpContext(res, { route, mode }) {
  if (!res.locals) res.locals = {};
  res.locals.httpRoute = route;
  res.locals.mode = mode;
  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  res.locals[HTTP_ROUTE_KEY] = route;
  // eslint-disable-next-line security/detect-object-injection -- symbol-based local metadata
  res.locals[HTTP_MODE_KEY] = mode;
}

export function getHttpContext(res) {
  if (!res) return { route: undefined, mode: undefined };
  const locals = res.locals || {};
  return {
    // eslint-disable-next-line security/detect-object-injection -- symbol-based lookup
    route: locals.httpRoute || locals[HTTP_ROUTE_KEY],
    // eslint-disable-next-line security/detect-object-injection -- symbol-based lookup
    mode: locals.mode || locals[HTTP_MODE_KEY],
  };
}
