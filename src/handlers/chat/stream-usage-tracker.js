export const createStreamUsageTracker = ({
  includeUsage = false,
  choiceCount = 1,
  promptTokensEst = 0,
  startedAt = Date.now(),
  getEmittedLength = () => 0,
  getFirstTokenAt = () => null,
  sendChunk = () => {},
  appendUsage,
  logSanitizerSummary,
  getSanitizerSummaryData,
  resolveFinishReason,
  hasToolCallEvidence,
  hasFunctionCall = false,
  toolCallAggregator,
  getToolStats = () => ({ count: 0, truncated: 0 }),
  stopAfterToolsMode,
  outputMode,
  req,
  res,
  reqId,
  route = "/v1/chat/completions",
  mode = "chat_stream",
  requestedModel,
  effectiveModel,
  getHttpContext,
  sanitizeMetadata = false,
  isDev = false,
} = {}) => {
  const usageState = {
    prompt: 0,
    completion: 0,
    emitted: false,
    logged: false,
    trigger: null,
    countsSource: "estimate",
    providerSupplied: false,
    firstTokenMs: null,
    totalDurationMs: null,
  };

  const updateUsageCounts = (trigger, { prompt, completion } = {}, { provider = false } = {}) => {
    const promptNum = Number.isFinite(prompt) ? Number(prompt) : NaN;
    const completionNum = Number.isFinite(completion) ? Number(completion) : NaN;
    let touched = false;
    if (!Number.isNaN(promptNum) && promptNum >= 0) {
      usageState.prompt = provider ? promptNum : Math.max(usageState.prompt, promptNum);
      touched = true;
    }
    if (!Number.isNaN(completionNum) && completionNum >= 0) {
      usageState.completion = provider
        ? completionNum
        : Math.max(usageState.completion, completionNum);
      touched = true;
    }
    if (touched) usageState.countsSource = "event";
    if (!usageState.trigger) usageState.trigger = trigger;
    if (provider) usageState.providerSupplied = true;
  };

  const resolveCounts = () => {
    const emittedLength = getEmittedLength();
    const estimatedCompletion = Math.ceil(emittedLength / 4);
    const usingEvent = usageState.countsSource === "event";
    const promptTokens = usingEvent ? usageState.prompt : promptTokensEst;
    const completionTokens = usingEvent ? usageState.completion : estimatedCompletion;
    const totalTokens = promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens, estimatedCompletion };
  };

  const emitUsageChunk = (trigger) => {
    if (usageState.emitted || !includeUsage) return false;
    const { promptTokens, completionTokens } = resolveCounts();
    const aggregatedCompletion = completionTokens * choiceCount;
    const aggregatedTotal = promptTokens + aggregatedCompletion;
    const firstTokenAt = getFirstTokenAt();
    const firstTokenMs = firstTokenAt === null ? null : Math.max(firstTokenAt - startedAt, 0);
    const totalDurationMs = Math.max(Date.now() - startedAt, 0);
    usageState.firstTokenMs = firstTokenMs;
    usageState.totalDurationMs = totalDurationMs;
    usageState.emitted = true;
    sendChunk({
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: aggregatedCompletion,
        total_tokens: aggregatedTotal,
        time_to_first_token_ms: firstTokenMs,
        total_duration_ms: totalDurationMs,
        time_to_first_token: null,
        throughput_after_first_token: null,
        emission_trigger: trigger,
      },
    });
    return true;
  };

  const logUsage = (trigger) => {
    if (usageState.logged || typeof appendUsage !== "function") return false;
    const { promptTokens, completionTokens, estimatedCompletion } = resolveCounts();
    const aggregatedCompletion = completionTokens * choiceCount;
    const aggregatedTotal = promptTokens + aggregatedCompletion;
    const aggregatedEstCompletion = estimatedCompletion * choiceCount;
    const emittedAtMs = Date.now() - startedAt;
    const firstTokenAt = getFirstTokenAt();
    const firstTokenMs =
      usageState.firstTokenMs !== null
        ? usageState.firstTokenMs
        : firstTokenAt === null
          ? null
          : Math.max(firstTokenAt - startedAt, 0);
    const totalDurationMs = usageState.totalDurationMs ?? emittedAtMs;
    const resolved = resolveFinishReason ? resolveFinishReason() : { reason: null, source: null };
    const { count, keys, sources } = getSanitizerSummaryData
      ? getSanitizerSummaryData()
      : { count: 0, keys: [], sources: [] };
    if (sanitizeMetadata && typeof logSanitizerSummary === "function") {
      logSanitizerSummary({
        enabled: true,
        route,
        mode,
        reqId,
        count,
        keys,
        sources,
      });
    }
    try {
      const httpCtx = typeof getHttpContext === "function" && res ? getHttpContext(res) || {} : {};
      appendUsage({
        req_id: reqId,
        route: httpCtx.route || route,
        mode: httpCtx.mode || mode,
        method: req?.method || "POST",
        status_code: 200,
        requested_model: requestedModel,
        effective_model: effectiveModel,
        stream: true,
        prompt_tokens: promptTokens,
        completion_tokens: aggregatedCompletion,
        total_tokens: aggregatedTotal,
        prompt_tokens_est: promptTokensEst,
        completion_tokens_est: aggregatedEstCompletion,
        total_tokens_est: promptTokensEst + aggregatedEstCompletion,
        duration_ms: emittedAtMs,
        total_duration_ms: totalDurationMs,
        status: 200,
        user_agent: req?.headers?.["user-agent"] || "",
        emission_trigger: trigger,
        emitted_at_ms: emittedAtMs,
        counts_source: usageState.countsSource,
        usage_included: includeUsage,
        provider_supplied: usageState.providerSupplied,
        time_to_first_token_ms: firstTokenMs,
        finish_reason: resolved.reason,
        finish_reason_source: resolved.source,
        has_tool_calls: typeof hasToolCallEvidence === "function" ? hasToolCallEvidence() : false,
        has_function_call:
          typeof hasFunctionCall === "function"
            ? Boolean(hasFunctionCall())
            : Boolean(hasFunctionCall),
        tool_call_parallel_supported: toolCallAggregator?.supportsParallelCalls?.() || false,
        tool_call_emitted: toolCallAggregator?.hasCalls?.() || false,
        tool_call_count_total: getToolStats().count,
        tool_call_truncated_total: getToolStats().truncated,
        stop_after_tools_mode: stopAfterToolsMode || "burst",
        choice_count: choiceCount,
        metadata_sanitizer_enabled: sanitizeMetadata,
        sanitized_metadata_count: sanitizeMetadata ? count : 0,
        sanitized_metadata_keys: sanitizeMetadata ? keys : [],
        sanitized_metadata_sources: sanitizeMetadata ? sources : [],
        output_mode: outputMode,
      });
    } catch (err) {
      if (isDev) {
        console.error("[dev][response][chat][stream] usage log error:", err);
      }
    }
    usageState.logged = true;
    return true;
  };

  const markTriggerIfMissing = (trigger) => {
    if (!usageState.trigger) usageState.trigger = trigger;
  };

  return {
    state: usageState,
    updateUsageCounts,
    resolveCounts,
    emitUsageChunk,
    logUsage,
    markTriggerIfMissing,
    hasEmitted: () => usageState.emitted,
    hasLogged: () => usageState.logged,
    getTrigger: () => usageState.trigger,
  };
};
