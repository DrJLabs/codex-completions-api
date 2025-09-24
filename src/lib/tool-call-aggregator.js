import { nanoid } from "nanoid";

const ARGUMENT_KEYS = ["arguments", "arguments_chunk", "argumentsChunk"];
const ID_KEYS = ["id", "tool_call_id", "toolCallId"];
const TOOL_CALL_KEYS = ["tool_calls", "toolCalls"];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const DEFAULT_TYPE = "function";

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const pickFirstString = (obj, keys) => {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    // eslint-disable-next-line security/detect-object-injection -- keys originate from static allowlist above
    const value = obj[key];
    if (typeof value === "string" && value.length) return value;
  }
  return null;
};

const extractToolCallsArray = (payload = {}) => {
  if (!payload || typeof payload !== "object") return [];
  for (const key of TOOL_CALL_KEYS) {
    if (!hasOwn(payload, key)) continue;
    // eslint-disable-next-line security/detect-object-injection -- keys originate from static allowlist above
    const candidate = payload[key];
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
  }
  return [];
};

const ensureFunctionObject = (entry) => {
  if (!entry.function || typeof entry.function !== "object") {
    entry.function = {};
  }
  return entry.function;
};

export function createToolCallAggregator({ idFactory } = {}) {
  const generateId = typeof idFactory === "function" ? idFactory : () => `tool_${nanoid(8)}`;

  const state = new Map();
  const order = [];
  let parallelToolCalls = true;

  const ensureState = (index) => {
    const idx = toNumberOrNull(index);
    const targetIndex = idx === null ? order.length : idx;
    if (!state.has(targetIndex)) {
      state.set(targetIndex, {
        index: targetIndex,
        id: null,
        type: null,
        fn: { name: null, args: "", fragments: [] },
        sent: { id: false, type: false, name: false },
        emitted: false,
      });
      order.push(targetIndex);
    }
    return state.get(targetIndex);
  };

  const normalizeType = (value, fallback) => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
    return DEFAULT_TYPE;
  };

  const getArgumentFragment = (source = {}) => {
    const direct = pickFirstString(source, ARGUMENT_KEYS);
    if (direct !== null) return direct;
    const fn =
      hasOwn(source, "function") && source.function && typeof source.function === "object"
        ? source.function
        : null;
    if (fn) return pickFirstString(fn, ARGUMENT_KEYS);
    return null;
  };

  const extractId = (source = {}, currentId = null, generator) => {
    for (const key of ID_KEYS) {
      if (!hasOwn(source, key)) continue;
      // eslint-disable-next-line security/detect-object-injection -- keys originate from static allowlist above
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (currentId && typeof currentId === "string") return currentId;
    return generator();
  };

  const updateParallelSupport = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const hasLegacyFlag =
      hasOwn(payload, "parallel_tool_calls") && payload.parallel_tool_calls === false;
    const hasCamelFlag =
      hasOwn(payload, "parallelToolCalls") && payload.parallelToolCalls === false;
    if (hasLegacyFlag || hasCamelFlag) {
      parallelToolCalls = false;
    }
  };

  const ingestInternal = (payload, { mode = "delta", emit = true, fallbackEmit = false } = {}) => {
    if (!payload || typeof payload !== "object") {
      return { deltas: [], updated: false };
    }

    updateParallelSupport(payload);
    const toolCalls = extractToolCallsArray(payload);
    if (!toolCalls.length) return { deltas: [], updated: false };

    const result = [];

    toolCalls.forEach((rawEntry, rawIdx) => {
      if (!rawEntry || typeof rawEntry !== "object") return;
      const indexValue = hasOwn(rawEntry, "index") ? rawEntry.index : rawIdx;
      const stateEntry = ensureState(indexValue);
      const shouldEmit = emit || (fallbackEmit && !stateEntry.emitted);

      const entryId = extractId(rawEntry, stateEntry.id, generateId);
      if (entryId !== stateEntry.id) {
        stateEntry.id = entryId;
        stateEntry.sent.id = false;
      }

      const resolvedType = normalizeType(rawEntry.type, stateEntry.type);
      if (resolvedType !== stateEntry.type) {
        stateEntry.type = resolvedType;
        stateEntry.sent.type = false;
      }

      const fnPayload =
        rawEntry.function && typeof rawEntry.function === "object" ? rawEntry.function : {};
      if (typeof fnPayload.name === "string" && fnPayload.name.trim()) {
        const trimmed = fnPayload.name.trim();
        if (trimmed !== stateEntry.fn.name) {
          stateEntry.fn.name = trimmed;
          stateEntry.sent.name = false;
        }
      }

      const argFragment = getArgumentFragment(rawEntry);
      if (argFragment !== null) {
        const buf = Buffer.from(argFragment, "utf8");
        if (mode === "message") {
          stateEntry.fn.fragments = [buf];
        } else {
          stateEntry.fn.fragments.push(buf);
        }
        stateEntry.fn.args = Buffer.concat(stateEntry.fn.fragments).toString("utf8");
      }

      if (!shouldEmit) return;

      const deltaEntry = { index: stateEntry.index };
      let touched = false;

      if (!stateEntry.sent.id && stateEntry.id) {
        deltaEntry.id = stateEntry.id;
        stateEntry.sent.id = true;
        touched = true;
      }

      if (!stateEntry.sent.type && stateEntry.type) {
        deltaEntry.type = stateEntry.type;
        stateEntry.sent.type = true;
        touched = true;
      }

      if (!stateEntry.sent.name && stateEntry.fn.name) {
        ensureFunctionObject(deltaEntry).name = stateEntry.fn.name;
        stateEntry.sent.name = true;
        touched = true;
      }

      const argsForDelta = mode === "message" ? stateEntry.fn.args : argFragment;
      if (typeof argsForDelta === "string" && argsForDelta.length) {
        ensureFunctionObject(deltaEntry).arguments = argsForDelta;
        touched = true;
      }

      if (touched) {
        result.push(deltaEntry);
        stateEntry.emitted = true;
      }
    });

    return { deltas: result, updated: result.length > 0 };
  };

  const snapshot = () => {
    if (!order.length) return [];
    return [...order]
      .sort((a, b) => a - b)
      .map((idx) => state.get(idx))
      .filter(Boolean)
      .map((entry) => {
        const fn = {};
        if (entry.fn.name) fn.name = entry.fn.name;
        fn.arguments = entry.fn.args || "";
        return {
          id: entry.id || generateId(),
          type: entry.type || DEFAULT_TYPE,
          function: fn,
        };
      });
  };

  return {
    ingestDelta(deltaPayload) {
      return ingestInternal(deltaPayload, { mode: "delta", emit: true });
    },
    ingestMessage(messagePayload, { emitIfMissing = false } = {}) {
      return ingestInternal(messagePayload, {
        mode: "message",
        emit: false,
        fallbackEmit: emitIfMissing,
      });
    },
    snapshot,
    hasCalls() {
      return state.size > 0;
    },
    supportsParallelCalls() {
      return parallelToolCalls;
    },
  };
}
