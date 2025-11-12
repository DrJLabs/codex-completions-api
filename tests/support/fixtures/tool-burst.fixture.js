export function buildBurstEnv({ burstCount = 2, stopAfterMode = "burst", extras = {} } = {}) {
  return {
    FAKE_CODEX_MODE: "multi_tool_burst",
    FAKE_CODEX_TOOL_BURST_COUNT: String(burstCount),
    PROXY_STOP_AFTER_TOOLS_MODE: stopAfterMode,
    PROXY_SUPPRESS_TAIL_AFTER_TOOLS: "true",
    ...extras,
  };
}

export function buildLegacyCapEnv({
  burstCount = 4,
  blockMax = 1,
  stopAfterMode = "first",
  extras = {},
} = {}) {
  return buildBurstEnv({
    burstCount,
    stopAfterMode,
    extras: {
      PROXY_TOOL_BLOCK_MAX: String(blockMax),
      ...extras,
    },
  });
}
