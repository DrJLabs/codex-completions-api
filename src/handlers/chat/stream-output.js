const TOOL_XML_PREFIXES = ["<use_tool", "</use_tool"];

export const createStreamOutputCoordinator = ({
  isObsidianOutput,
  outputMode,
  stopAfterTools,
  suppressTailAfterTools,
  toolCallAggregator,
  toolBufferMetrics,
  ensureChoiceState,
  forEachChoice,
  onTextualToolBlocks,
  sendChoiceDelta,
  emitTextualToolMetadata,
  scheduleStopAfterTools,
  extractUseToolBlocks,
  trackToolBufferOpen,
  detectNestedToolBuffer,
  clampEmittableIndex,
  completeToolBuffer,
  abortToolBuffer,
  shouldSkipBlock,
  trimTrailingTextAfterToolBlocks,
  buildObsidianXmlRecord,
  logToolBufferWarning,
}) => {
  const hasTextualToolPrefix = (state, textDelta = "") => {
    if (!isObsidianOutput || !state) return false;
    if (state.toolBuffer?.active) return true;
    const emitted = typeof state.emitted === "string" ? state.emitted : "";
    const combined = `${emitted}${textDelta || ""}`;
    if (!combined) return false;
    if (combined.includes("<use_tool") || combined.includes("</use_tool")) return true;
    for (const prefix of TOOL_XML_PREFIXES) {
      const maxLen = Math.min(prefix.length, combined.length);
      for (let len = maxLen; len > 0; len -= 1) {
        const suffix = combined.slice(combined.length - len);
        if (prefix.startsWith(suffix)) {
          return true;
        }
      }
    }
    return false;
  };

  const findToolPrefixHoldback = (emitted, forwardedUpTo) => {
    if (!isObsidianOutput) return -1;
    const text = typeof emitted === "string" ? emitted : "";
    if (!text) return -1;
    const startFloor = Number.isInteger(forwardedUpTo) ? forwardedUpTo : 0;
    let holdbackStart = -1;
    for (const prefix of TOOL_XML_PREFIXES) {
      const maxLen = Math.min(prefix.length, text.length);
      for (let len = maxLen; len > 0; len -= 1) {
        const suffix = text.slice(text.length - len);
        if (prefix.startsWith(suffix)) {
          const start = text.length - len;
          if (start >= startFloor) {
            if (holdbackStart === -1 || start < holdbackStart) holdbackStart = start;
          }
          break;
        }
      }
    }
    return holdbackStart;
  };

  const emitToolContentChunk = (content, { source = "aggregator", choiceIndex = 0 } = {}) => {
    if (!isObsidianOutput) return false;
    const state = ensureChoiceState(choiceIndex);
    if (source === "aggregator" && state.textualToolContentSeen) return false;
    const text = typeof content === "string" ? content : "";
    if (!text) return false;
    emitTextualToolMetadata(choiceIndex, text);
    state.dropAssistantContentAfterTools = true;
    state.hasToolEvidence = true;
    sendChoiceDelta(choiceIndex, { content: text });
    state.sentAny = true;
    state.forwardedToolCount = Math.max(0, (state.forwardedToolCount || 0) + 1);
    if (source === "textual") state.textualToolContentSeen = true;
    scheduleStopAfterTools(choiceIndex);
    return true;
  };

  const flushActiveToolBuffer = (state, choiceIndex, reason = "abort") => {
    if (!isObsidianOutput) return false;
    if (!state?.toolBuffer?.active) return false;
    const emittedText = typeof state.emitted === "string" ? state.emitted : "";
    const lastClose = emittedText.lastIndexOf("</use_tool>");
    if (lastClose >= 0) {
      completeToolBuffer(state.toolBuffer, lastClose + "</use_tool>".length);
      return false;
    }
    const { literal } = abortToolBuffer(state.toolBuffer, state.emitted);
    toolBufferMetrics.abort({ output_mode: outputMode, reason });
    logToolBufferWarning(reason, { choice_index: choiceIndex });
    if (!literal) return false;
    const emitted = emitToolContentChunk(literal, { source: "textual", choiceIndex });
    if (emitted) {
      state.textualToolContentSeen = true;
      state.sentAny = true;
      state.forwardedUpTo = state.emitted.length;
      state.scanPos = state.emitted.length;
      state.dropAssistantContentAfterTools = true;
    }
    return emitted;
  };

  const flushDanglingToolBuffers = (reason = "finalize") => {
    if (!isObsidianOutput) return;
    if (typeof forEachChoice === "function") {
      forEachChoice((idx) => {
        const state = ensureChoiceState(idx);
        flushActiveToolBuffer(state, idx, reason);
      });
      return;
    }
    const state = ensureChoiceState(0);
    flushActiveToolBuffer(state, 0, reason);
  };

  const emitAggregatorToolContent = (choiceIndex = 0, snapshot = null) => {
    if (!isObsidianOutput) return false;
    const state = ensureChoiceState(choiceIndex);
    if (state.textualToolContentSeen) {
      const size = Array.isArray(snapshot)
        ? snapshot.length
        : toolCallAggregator.snapshot({ choiceIndex }).length;
      state.forwardedToolCount = Math.max(state.forwardedToolCount || 0, size);
      return false;
    }
    try {
      const records = Array.isArray(snapshot)
        ? snapshot
        : toolCallAggregator.snapshot({ choiceIndex });
      let emitted = false;
      while (state.forwardedToolCount < records.length) {
        const ordinal = state.forwardedToolCount;
        // eslint-disable-next-line security/detect-object-injection -- ordinal indexes sequential tool calls
        const xml = buildObsidianXmlRecord(records[ordinal]);
        if (!xml) break;
        if (!emitToolContentChunk(xml, { source: "aggregator", choiceIndex })) break;
        emitted = true;
      }
      if (!emitted && state.forwardedToolCount > records.length) {
        state.forwardedToolCount = records.length;
      }
      return emitted;
    } catch (err) {
      if (typeof logToolBufferWarning === "function") {
        logToolBufferWarning("aggregator_tool_emit_failed", {
          choice_index: choiceIndex,
          error: err?.message,
        });
      }
      return false;
    }
  };

  const appendContentSegment = (text, { choiceIndex = 0 } = {}) => {
    const state = ensureChoiceState(choiceIndex);
    if (state.dropAssistantContentAfterTools) {
      scheduleStopAfterTools(choiceIndex);
      return;
    }
    if (!text) return;
    let emittedTextualTool = false;
    let appendText = text;
    if (state.emitted) {
      if (appendText.startsWith(state.emitted)) {
        appendText = appendText.slice(state.emitted.length);
      } else {
        const maxOverlap = Math.min(state.emitted.length, appendText.length);
        let overlap = 0;
        for (let i = maxOverlap; i > 0; i -= 1) {
          if (state.emitted.slice(state.emitted.length - i) === appendText.slice(0, i)) {
            overlap = i;
            break;
          }
        }
        appendText = appendText.slice(overlap);
        if (!appendText && state.emitted.includes(text)) {
          appendText = "";
        }
      }
    }
    if (!appendText) {
      scheduleStopAfterTools(choiceIndex);
      return;
    }
    state.emitted += appendText;
    if (isObsidianOutput) {
      const startedAt = trackToolBufferOpen(state.toolBuffer, state.emitted, state.forwardedUpTo);
      if (startedAt >= 0) {
        toolBufferMetrics.start({ output_mode: outputMode });
      }
      const nestedAt = detectNestedToolBuffer(state.toolBuffer, state.emitted);
      if (nestedAt >= 0) {
        flushActiveToolBuffer(state, choiceIndex, "nested_open");
      }
    }
    try {
      const { blocks, nextPos } = extractUseToolBlocks(state.emitted, state.scanPos);
      if (blocks && blocks.length) {
        if (typeof onTextualToolBlocks === "function") {
          onTextualToolBlocks(blocks.length);
        }
        state.hasToolEvidence = true;
        state.lastToolEnd = blocks[blocks.length - 1].end;
        state.scanPos = nextPos;
        for (const block of blocks) {
          if (block.end <= state.forwardedUpTo) continue;
          if (shouldSkipBlock(state.toolBuffer, block.end)) continue;
          const literal = state.emitted.slice(block.start, block.end);
          if (!literal) continue;
          if (isObsidianOutput) {
            if (emitToolContentChunk(literal, { source: "textual", choiceIndex })) {
              emittedTextualTool = true;
              state.forwardedUpTo = block.end;
              completeToolBuffer(state.toolBuffer, block.end);
              toolBufferMetrics.flush({ output_mode: outputMode });
              continue;
            }
          } else {
            state.forwardedUpTo = block.end;
            state.dropAssistantContentAfterTools = true;
            break;
          }
        }
      }
    } catch (err) {
      if (typeof logToolBufferWarning === "function") {
        logToolBufferWarning("textual_extraction_failed", {
          choice_index: choiceIndex,
          error: err?.message,
        });
      }
    }
    const limitTail = suppressTailAfterTools || stopAfterTools;
    if (emittedTextualTool && limitTail) {
      scheduleStopAfterTools(choiceIndex);
      return;
    }
    const allowUntil = clampEmittableIndex(
      state.toolBuffer,
      state.forwardedUpTo,
      state.emitted.length,
      state.lastToolEnd,
      limitTail
    );
    const holdbackStart = findToolPrefixHoldback(state.emitted, state.forwardedUpTo);
    const finalUntil = holdbackStart >= 0 ? Math.min(allowUntil, holdbackStart) : allowUntil;
    let segment = state.emitted.slice(state.forwardedUpTo, finalUntil);
    if (segment) {
      if (limitTail) {
        segment = trimTrailingTextAfterToolBlocks(segment);
      }
      let segmentHasToolBlock = false;
      if (segment && limitTail && state.textualToolContentSeen) {
        try {
          const { blocks } = extractUseToolBlocks(segment, 0);
          segmentHasToolBlock = Boolean(blocks && blocks.length);
        } catch (err) {
          if (typeof logToolBufferWarning === "function") {
            logToolBufferWarning("textual_extraction_failed", {
              choice_index: choiceIndex,
              error: err?.message,
              phase: "segment",
            });
          }
        }
      }
      if (segment && limitTail && state.textualToolContentSeen && segmentHasToolBlock) {
        state.forwardedUpTo = finalUntil;
        scheduleStopAfterTools(choiceIndex);
        return;
      }
      if (segment) {
        sendChoiceDelta(choiceIndex, { content: segment });
      }
      state.sentAny = true;
      state.forwardedUpTo = finalUntil;
    }
    scheduleStopAfterTools(choiceIndex);
  };

  return {
    appendContentSegment,
    emitToolContentChunk,
    emitAggregatorToolContent,
    flushDanglingToolBuffers,
    hasTextualToolPrefix,
  };
};
