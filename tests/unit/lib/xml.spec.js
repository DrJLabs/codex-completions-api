import { describe, expect, it } from "vitest";
import { buildXmlTag, escapeXml, formatXmlValue } from "../../../src/lib/tools/xml.js";

describe("xml helpers", () => {
  it("escapes xml special characters and handles nullish values", () => {
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(undefined)).toBe("");
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("formats objects and arrays with json escaping", () => {
    const value = { text: "a&b" };
    const arrayValue = ["<tag>"];

    expect(formatXmlValue(value)).toBe("{&quot;text&quot;:&quot;a&amp;b&quot;}");
    expect(formatXmlValue(arrayValue)).toBe("[&quot;&lt;tag&gt;&quot;]");
  });

  it("falls back to string formatting when json serialization fails", () => {
    const cyclic = {};
    cyclic.self = cyclic;

    expect(formatXmlValue(cyclic)).toBe("[object Object]");
  });

  it("stringifies non-finite numbers", () => {
    expect(formatXmlValue(Infinity)).toBe("Infinity");
  });

  it("builds xml tags with trimmed names and default indent", () => {
    expect(buildXmlTag(" note ", "a&b")).toBe("  <note>a&amp;b</note>");
    expect(buildXmlTag("", "ok", "")).toBe("<value>ok</value>");
  });
});
