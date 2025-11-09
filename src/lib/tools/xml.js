const XML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const XML_ESCAPE_REGEX = /[&<>"']/g;

export function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(XML_ESCAPE_REGEX, (match) => XML_ESCAPE_MAP[match] || match);
}

const isObject = (value) => value !== null && typeof value === "object";

export function formatXmlValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || isObject(value)) {
    try {
      return escapeXml(JSON.stringify(value));
    } catch {
      return escapeXml(String(value));
    }
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return escapeXml(String(value));
  }
  return escapeXml(String(value));
}

export function buildXmlTag(tagName, value, indent = "  ") {
  const safeName = String(tagName || "value").trim() || "value";
  const inner = formatXmlValue(value);
  return `${indent}<${safeName}>${inner}</${safeName}>`;
}
