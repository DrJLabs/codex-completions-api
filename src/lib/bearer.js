export function bearerTokenFromAuthHeader(value) {
  const auth = typeof value === "string" ? value : "";
  if (!auth) return "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export function bearerToken(req) {
  return bearerTokenFromAuthHeader(req?.headers?.authorization);
}
