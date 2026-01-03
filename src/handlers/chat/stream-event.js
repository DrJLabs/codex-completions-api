export const parseStreamEventLine = (
  line,
  { resolveChoiceIndexFromPayload, extractMetadataFromPayload, sanitizeMetadata = false } = {}
) => {
  if (!line || typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  let evt;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rawType = (evt && (evt.msg?.type || evt.type)) || "";
  const type = typeof rawType === "string" ? rawType.replace(/^codex\/event\//i, "") : "";
  const payload = evt && typeof evt === "object" ? evt : {};
  const params = payload.msg && typeof payload.msg === "object" ? payload.msg : payload;
  const messagePayload = params.msg && typeof params.msg === "object" ? params.msg : params;
  const metadataInfo =
    sanitizeMetadata && typeof extractMetadataFromPayload === "function"
      ? extractMetadataFromPayload(params)
      : null;
  const baseChoiceIndex =
    typeof resolveChoiceIndexFromPayload === "function"
      ? resolveChoiceIndexFromPayload(params, messagePayload)
      : null;

  return {
    type,
    payload,
    params,
    messagePayload,
    metadataInfo,
    baseChoiceIndex,
  };
};
