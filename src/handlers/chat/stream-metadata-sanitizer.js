export const createStreamMetadataSanitizer = ({
  sanitizeMetadata = false,
  reqId,
  route = "/v1/chat/completions",
  mode = "chat_stream",
  appendProtoEvent,
  logSanitizerToggle,
  metadataKeys = () => [],
  normalizeMetadataKey = (key) => key,
  sanitizeMetadataTextSegment,
  appendContentSegment = () => {},
  scheduleStopAfterTools = () => {},
} = {}) => {
  const sanitizedContentStates = new Map();
  const sanitizedMetadataSummary = { count: 0, keys: new Set(), sources: new Set() };
  const seenSanitizedRemovalSignatures = new Set();
  const mergedMetadata = { metadata: {}, sources: new Set() };
  const metadataKeyRegister = new Set(typeof metadataKeys === "function" ? metadataKeys() : []);

  if (typeof logSanitizerToggle === "function") {
    logSanitizerToggle({
      enabled: sanitizeMetadata,
      trigger: "request",
      route,
      mode,
      reqId,
    });
  }

  const getSanitizedContentState = (choiceIndex = 0) => {
    const normalized = Number.isInteger(choiceIndex) && choiceIndex >= 0 ? choiceIndex : 0;
    if (!sanitizedContentStates.has(normalized)) {
      sanitizedContentStates.set(normalized, {
        pending: "",
        lastContext: { stage: "agent_message_delta", eventType: "agent_message_delta" },
      });
    }
    return sanitizedContentStates.get(normalized);
  };

  const listChoiceIndexes = () => Array.from(sanitizedContentStates.keys());

  const mergeMetadataInfo = (info) => {
    if (!info || typeof info !== "object") {
      const hasMetadata = Object.keys(mergedMetadata.metadata).length > 0;
      const hasSources = mergedMetadata.sources.size > 0;
      if (!hasMetadata && !hasSources) return null;
      return {
        metadata: { ...mergedMetadata.metadata },
        sources: Array.from(mergedMetadata.sources),
      };
    }
    const incomingMetadata =
      info.metadata && typeof info.metadata === "object" ? info.metadata : {};
    for (const [rawKey, rawValue] of Object.entries(incomingMetadata)) {
      const normalized = normalizeMetadataKey(rawKey);
      if (!normalized) continue;
      // eslint-disable-next-line security/detect-object-injection
      mergedMetadata.metadata[normalized] = rawValue;
      metadataKeyRegister.add(normalized);
    }
    if (Array.isArray(info.sources)) {
      for (const source of info.sources) {
        if (typeof source === "string" && source) mergedMetadata.sources.add(source);
      }
    }
    const hasMetadata = Object.keys(mergedMetadata.metadata).length > 0;
    const hasSources = mergedMetadata.sources.size > 0;
    if (!hasMetadata && !hasSources) return null;
    return {
      metadata: { ...mergedMetadata.metadata },
      sources: Array.from(mergedMetadata.sources),
    };
  };

  const getSummaryData = () => ({
    count: sanitizedMetadataSummary.count,
    keys: Array.from(sanitizedMetadataSummary.keys),
    sources: Array.from(sanitizedMetadataSummary.sources),
  });

  const shouldHoldPartialLine = (candidate, keys) => {
    if (!candidate) return false;
    const trimmed = candidate.trimStart();
    if (!trimmed) return false;
    const withoutContainers = trimmed.replace(/^[[{]\s*/, "");
    const match = withoutContainers.match(/^['"]?([A-Za-z0-9._-]+)/);
    if (!match) return false;
    const candidateKey = normalizeMetadataKey(match[1]);
    if (!candidateKey) return false;
    const hasSeparator = /[:=]/.test(withoutContainers);
    if (hasSeparator) return keys.has(candidateKey);
    for (const key of keys) {
      if (key.startsWith(candidateKey)) return true;
    }
    return false;
  };

  const recordSanitizedMetadata = ({ stage, eventType, metadata, removed, sources }) => {
    if (!sanitizeMetadata) return;
    const metadataObject =
      metadata && typeof metadata === "object" && Object.keys(metadata).length ? metadata : null;
    const removedEntries = Array.isArray(removed)
      ? removed.filter((entry) => entry && typeof entry === "object")
      : [];
    if (metadataObject) {
      for (const key of Object.keys(metadataObject)) {
        const normalizedKey = normalizeMetadataKey(key);
        if (normalizedKey) {
          sanitizedMetadataSummary.keys.add(normalizedKey);
          metadataKeyRegister.add(normalizedKey);
        }
      }
    }
    const uniqueRemovedEntries = [];
    if (removedEntries.length) {
      for (const entry of removedEntries) {
        const normalizedKey = normalizeMetadataKey(entry.key);
        const signature = `${normalizedKey || ""}::${entry.raw || ""}`;
        if (!signature.trim()) continue;
        if (seenSanitizedRemovalSignatures.has(signature)) continue;
        seenSanitizedRemovalSignatures.add(signature);
        if (normalizedKey) {
          sanitizedMetadataSummary.keys.add(normalizedKey);
          metadataKeyRegister.add(normalizedKey);
        }
        uniqueRemovedEntries.push({ ...entry, key: normalizedKey || entry.key });
      }
      sanitizedMetadataSummary.count += uniqueRemovedEntries.length;
    }
    const sourceList = Array.isArray(sources)
      ? sources.filter((source) => typeof source === "string" && source)
      : [];
    for (const source of sourceList) sanitizedMetadataSummary.sources.add(source);
    if (!metadataObject && !uniqueRemovedEntries.length) return;
    if (typeof appendProtoEvent === "function") {
      appendProtoEvent({
        ts: Date.now(),
        req_id: reqId,
        route,
        mode,
        kind: "metadata_sanitizer",
        toggle_enabled: true,
        stage,
        event_type: eventType,
        metadata: metadataObject || undefined,
        removed_lines: uniqueRemovedEntries.length ? uniqueRemovedEntries : undefined,
        metadata_sources: sourceList.length ? sourceList : undefined,
      });
    }
  };

  const applyMetadataSanitizer = (segment, metadataInfo, { stage, eventType }) => {
    if (!sanitizeMetadata) return segment;
    const metadata = metadataInfo?.metadata || {};
    const { text: sanitizedText, removed } = sanitizeMetadataTextSegment(segment ?? "", metadata);
    if (metadataInfo || (removed && removed.length)) {
      recordSanitizedMetadata({
        stage,
        eventType,
        metadata: metadataInfo ? metadata : null,
        removed,
        sources: metadataInfo?.sources,
      });
    }
    return sanitizedText;
  };

  const drainPendingSanitized = (choiceIndex = 0, { flush = false, metadataInfo = null } = {}) => {
    if (!sanitizeMetadata) return;
    const state = getSanitizedContentState(choiceIndex);
    if (!state.pending) return;
    const info = metadataInfo || mergeMetadataInfo(null);
    const emitPortion = (portion) => {
      if (!portion) return;
      const sanitizedPortion = applyMetadataSanitizer(portion, info, state.lastContext);
      if (sanitizedPortion) {
        appendContentSegment(sanitizedPortion, { choiceIndex });
      } else if (portion.trim()) {
        scheduleStopAfterTools(choiceIndex);
      }
    };
    while (state.pending) {
      if (!flush) {
        const newlineIdx = state.pending.indexOf("\n");
        if (newlineIdx >= 0) {
          const portion = state.pending.slice(0, newlineIdx + 1);
          state.pending = state.pending.slice(newlineIdx + 1);
          emitPortion(portion);
          continue;
        }
        if (shouldHoldPartialLine(state.pending, metadataKeyRegister)) break;
      }
      const portion = state.pending;
      state.pending = "";
      emitPortion(portion);
      if (!flush) break;
    }
  };

  const enqueueSanitizedSegment = (
    segment,
    metadataInfo,
    context = {},
    { flush = false, choiceIndex = 0 } = {}
  ) => {
    if (!sanitizeMetadata) {
      if (segment) appendContentSegment(segment, { choiceIndex });
      return;
    }
    const state = getSanitizedContentState(choiceIndex);
    if (context.stage || context.eventType) {
      state.lastContext = {
        stage: context.stage || state.lastContext.stage,
        eventType: context.eventType || state.lastContext.eventType,
      };
    }
    const mergedInfo = mergeMetadataInfo(metadataInfo);
    if (segment) state.pending += segment;
    drainPendingSanitized(choiceIndex, { flush, metadataInfo: mergedInfo });
  };

  const flushSanitizedSegments = (context = {}) => {
    if (!sanitizeMetadata) return;
    const targets =
      typeof context.choiceIndex === "number"
        ? [context.choiceIndex]
        : sanitizedContentStates.size
          ? Array.from(sanitizedContentStates.keys())
          : [0];
    targets.forEach((idx) => {
      const state = getSanitizedContentState(idx);
      if (context.stage || context.eventType) {
        state.lastContext = {
          stage: context.stage || state.lastContext.stage,
          eventType: context.eventType || state.lastContext.eventType,
        };
      }
      drainPendingSanitized(idx, { flush: true });
    });
  };

  const emitSummaryProtoEvent = () => {
    if (!sanitizeMetadata) return;
    const { count, keys, sources } = getSummaryData();
    if (typeof appendProtoEvent !== "function") return;
    appendProtoEvent({
      ts: Date.now(),
      req_id: reqId,
      route,
      mode,
      kind: "metadata_sanitizer_summary",
      sanitized_count: count,
      sanitized_keys: keys,
      sanitized_sources: sources,
    });
  };

  return {
    getSanitizedContentState,
    listChoiceIndexes,
    mergeMetadataInfo,
    recordSanitizedMetadata,
    applyMetadataSanitizer,
    enqueueSanitizedSegment,
    flushSanitizedSegments,
    getSummaryData,
    emitSummaryProtoEvent,
  };
};
