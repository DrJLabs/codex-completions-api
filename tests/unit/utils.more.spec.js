/* eslint-disable security/detect-object-injection */
import { describe, it, expect } from "vitest";
import { toStringContent, normalizeModel, applyCors } from "../../src/utils.js";

describe("toStringContent", () => {
  it("stringifies objects and falls back on circular", () => {
    const obj = { a: 1 };
    expect(toStringContent(obj)).toBe(JSON.stringify(obj));
    const circ = { a: 1 };
    // @ts-ignore
    circ.self = circ; // create circular
    // JSON.stringify throws ⇒ fallback to String(obj)
    expect(toStringContent(circ)).toBe("[object Object]");
  });
});

describe("normalizeModel defaults", () => {
  it("returns empty requested/effective when name empty", () => {
    const r = normalizeModel("");
    expect(r).toEqual({ requested: "", effective: "" });
  });
});

describe("applyCors headers", () => {
  it("sets methods/headers/max-age", () => {
    const headers = {};
    const res = {
      setHeader: (k, v) => {
        headers[k] = v;
      },
    };
    applyCors({ headers: { origin: "http://x" } }, res, true);
    expect(headers["Access-Control-Allow-Methods"]).toContain("OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(headers["Access-Control-Max-Age"]).toBe("600");
  });
});
