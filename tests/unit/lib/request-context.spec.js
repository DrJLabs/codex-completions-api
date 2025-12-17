import { describe, expect, test } from "vitest";
import { ensureReqId, setHttpContext, getHttpContext } from "../../../src/lib/request-context.js";

const createRes = () => ({ locals: {} });

describe("request-context helpers", () => {
  test("ensureReqId reuses existing locals req_id", () => {
    const res = createRes();
    res.locals.req_id = "abc123";
    const id = ensureReqId(res);
    expect(id).toBe("abc123");
    expect(res.locals.req_id).toBe("abc123");
  });

  test("ensureReqId assigns a new id when missing", () => {
    const res = createRes();
    const id = ensureReqId(res);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(res.locals.req_id).toBe(id);
  });

  test("setHttpContext stores route/mode on locals and symbols", () => {
    const res = createRes();
    setHttpContext(res, { route: "/v1/chat", mode: "chat_stream" });
    expect(res.locals.httpRoute).toBe("/v1/chat");
    expect(res.locals.mode).toBe("chat_stream");
  });

  test("getHttpContext reads either plain or symbol values", () => {
    const res = createRes();
    setHttpContext(res, { route: "/v1/models", mode: "models" });
    const ctx = getHttpContext(res);
    expect(ctx).toEqual({ route: "/v1/models", mode: "models" });
  });

  test("getHttpContext returns undefineds safely when missing", () => {
    expect(getHttpContext(undefined)).toEqual({ route: undefined, mode: undefined });
    expect(getHttpContext({ locals: {} })).toEqual({ route: undefined, mode: undefined });
  });
});
