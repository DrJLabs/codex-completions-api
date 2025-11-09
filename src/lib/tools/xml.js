const XML_ESCAPE_REGEX = /[&<>"']/g;

function escapeCharacter(match) {
  switch (match) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    case "'":
      return "&apos;";
    default:
      return match;
  }
}

export function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(XML_ESCAPE_REGEX, escapeCharacter);
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
