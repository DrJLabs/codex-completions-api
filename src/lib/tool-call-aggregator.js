import { buildCanonicalJsonFromFields } from "./tools/obsidianToolsSpec.ts";

const DEFAULT_TYPE = "function";
const ARGUMENT_KEYS = ["arguments", "arguments_chunk", "argumentsChunk"];
const ID_KEYS = ["id", "tool_call_id", "toolCallId", "call_id", "item_id"];
const TOOL_CALL_ARRAY_KEYS = ["tool_calls", "toolCalls"];
const FUNCTION_CALL_KEYS = ["function_call", "functionCall"];
const INDEX_KEYS = ["index", "tool_call_index", "toolCallIndex"];

const TEXT_PATTERN_REGISTRY = new Map();

const defaultIdFactory = ({ choiceIndex, ordinal }) => `tool_${choiceIndex}_${ordinal}`;

const DEFAULT_PATTERN_NAME = "use_tool";

export function registerTextPattern(name, matcher) {
  const key = typeof name === "string" ? name.trim() : "";
  if (!key || typeof matcher !== "function") return () => {};
  TEXT_PATTERN_REGISTRY.set(key, matcher);
  return () => TEXT_PATTERN_REGISTRY.delete(key);
}

function defaultUseToolMatcher(text = "", startAt = 0) {
  const blocks = [];
  const openTag = "<use_tool";
  const closeTag = "</use_tool>";
  let cursor = Math.max(0, Number(startAt) || 0);

  while (cursor < text.length) {
    const openIdx = text.indexOf(openTag, cursor);
    if (openIdx < 0) break;
    const closeIdx = text.indexOf(closeTag, openIdx);
    if (closeIdx < 0) break;
    const endIdx = closeIdx + closeTag.length;
    const raw = text.slice(openIdx, endIdx);
    const block = parseUseToolBlock(raw);
    block.indexStart = openIdx;
    block.indexEnd = endIdx;
    block.start = openIdx;
    block.end = endIdx;
    blocks.push(block);
    cursor = endIdx;
  }

  return { blocks, nextPos: cursor };
}

registerTextPattern(DEFAULT_PATTERN_NAME, defaultUseToolMatcher);

export function extractUseToolBlocks(text = "", startAt = 0) {
  return executeTextPatterns(text, startAt);
}

function executeTextPatterns(text = "", startAt = 0) {
  const normalizedText = typeof text === "string" ? text : "";
  const normalizedStart = Math.max(0, Number(startAt) || 0);
  const blocks = [];
  let furthest = normalizedStart;
  const matchers = TEXT_PATTERN_REGISTRY.size
    ? [...TEXT_PATTERN_REGISTRY.values()]
    : [defaultUseToolMatcher];

  matchers.forEach((matcher) => {
    try {
      const result = matcher(normalizedText, normalizedStart) || {};
      if (Array.isArray(result.blocks)) {
        result.blocks.forEach((block) => {
          if (block && typeof block === "object") {
            blocks.push(block);
          }
        });
      }
      if (typeof result.nextPos === "number" && Number.isFinite(result.nextPos)) {
        furthest = Math.max(furthest, result.nextPos);
      }
    } catch {}
  });

  blocks.sort((a, b) => (a?.indexStart ?? 0) - (b?.indexStart ?? 0));
  return { blocks, nextPos: furthest };
}

function runTextPatterns(text = "", startAt = 0) {
  return executeTextPatterns(text, startAt).blocks;
}

const parseUseToolBlock = (raw = "") => {
  const block = {
    raw,
    name: "",
    fields: {},
    argsText: "",
    path: "",
    query: "",
  };

  const openEnd = raw.indexOf(">");
  const closeStart = raw.lastIndexOf("</use_tool>");
  if (openEnd < 0 || closeStart < 0 || closeStart <= openEnd) {
    return block;
  }
  const inner = raw.slice(openEnd + 1, closeStart);
  const header = raw.slice(0, openEnd + 1);
  const attrMatch = header.match(/name\s*=\s*"([^"]+)"|name\s*=\s*'([^']+)'/);
  if (attrMatch && !block.name) {
    block.name = (attrMatch[1] || attrMatch[2] || "").trim();
  }
  const tagRegex = /<([a-zA-Z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = tagRegex.exec(inner))) {
    const tag = (match[1] || "").trim();
    if (!tag) continue;
    const value = (match[2] || "").trim();
    if (tag.toLowerCase() === "name") {
      block.name = value;
      continue;
    }
    block.fields[tag] = value;
  }

  block.path = block.fields.path || "";
  block.query = block.fields.query || "";

  if (Object.keys(block.fields).length === 0) {
    const trimmed = inner.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          Object.entries(parsed).forEach(([key, value]) => {
            if (key === "name" && !block.name && typeof value === "string") {
              block.name = value;
            } else if (value !== undefined) {
              block.fields[key] = typeof value === "string" ? value : JSON.stringify(value);
            }
          });
        }
        block.argsText = trimmed;
        block.path = block.fields.path || "";
        block.query = block.fields.query || "";
        return block;
      } catch {}
    }
  }

  if (block.fields.args) {
    block.argsText = block.fields.args.trim();
  } else if (Object.keys(block.fields).length > 0) {
    const copy = { ...block.fields };
    delete copy.args;
    block.argsText = buildCanonicalJsonFromFields(block.name || "", copy);
  } else {
    block.argsText = "";
  }

  return block;
};

function pickFirstString(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (typeof value === "string" && value.length) return value;
  }
  return null;
}

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function extractArgumentFragment(payload = {}) {
  const direct = pickFirstString(payload, ARGUMENT_KEYS);
  if (direct !== null) return direct;
  const fnPayload = payload.function && typeof payload.function === "object" ? payload.function : null;
  if (fnPayload) {
    const nested = pickFirstString(fnPayload, ARGUMENT_KEYS);
    if (nested !== null) return nested;
  }
  return null;
}

function detectIndex(payload = {}) {
  for (const key of INDEX_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const idx = toNumberOrNull(payload[key]);
      if (idx !== null) return idx;
    }
  }
  return null;
}

function collectFragments(root, { mode = "delta", choiceIndex = 0 }) {
  if (!root || typeof root !== "object") return [];
  const queue = [root];
  const visited = new WeakSet();
  const fragments = [];

  const enqueue = (value) => {
    if (!value || typeof value !== "object") return;
    queue.push(value);
  };

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item) => enqueue(item));
      continue;
    }

    for (const key of TOOL_CALL_ARRAY_KEYS) {
      if (Array.isArray(node[key]) && node[key].length) {
        node[key].forEach((entry, idx) => {
          if (!entry || typeof entry !== "object") return;
          fragments.push({
            choiceIndex,
            raw: entry,
            id: pickFirstString(entry, ID_KEYS),
            callId: entry.id,
            index: detectIndex(entry) ?? idx,
            type: typeof entry.type === "string" ? entry.type : DEFAULT_TYPE,
            name: entry.function?.name,
            arguments: extractArgumentFragment(entry),
            mode,
          });
        });
      }
    }

    for (const key of FUNCTION_CALL_KEYS) {
      if (node[key] && typeof node[key] === "object") {
        fragments.push({
          choiceIndex,
          raw: node[key],
          id: pickFirstString(node[key], ID_KEYS),
          index: detectIndex(node),
          type: DEFAULT_TYPE,
          name: node[key].name,
          arguments: extractArgumentFragment(node[key]),
          mode,
        });
      }
    }

    const eventType = typeof node.type === "string" ? node.type.toLowerCase() : "";
    if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
      const item = node.item && typeof node.item === "object" ? node.item : {};
      if (item.type === "function_call") {
        fragments.push({
          choiceIndex,
          raw: item,
          backendId: item.id,
          type: DEFAULT_TYPE,
          name: item.name,
          arguments: extractArgumentFragment(item),
          mode,
        });
      }
    } else if (eventType === "response.function_call_arguments.delta") {
      fragments.push({
        choiceIndex,
        raw: node,
        backendId: node.item_id || node.call_id,
        arguments: typeof node.delta === "string" ? node.delta : node.arguments || "",
        type: DEFAULT_TYPE,
        mode: "delta",
      });
    } else if (eventType === "response.function_call_arguments.done") {
      fragments.push({
        choiceIndex,
        raw: node,
        backendId: node.item_id || node.call_id,
        arguments: typeof node.arguments === "string" ? node.arguments : "",
        type: DEFAULT_TYPE,
        mode: "message",
        replaceArgs: true,
      });
    }

    if (node.msg && typeof node.msg === "object") enqueue(node.msg);
    if (node.message && typeof node.message === "object") enqueue(node.message);
    if (node.delta && typeof node.delta === "object") enqueue(node.delta);
    if (Array.isArray(node.deltas)) node.deltas.forEach((d) => enqueue(d));
    if (Array.isArray(node.items)) node.items.forEach((d) => enqueue(d));
  }

  return fragments;
}

function extractMetadataText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) return payload.content.join("");
  if (typeof payload.text === "string") return payload.text;
  if (payload.message) return extractMetadataText(payload.message);
  return "";
}

function registerAlias(choiceState, alias, key) {
  if (!alias) return;
  choiceState.aliasToKey.set(alias, key);
}

function resolveKey(choiceState, fragment) {
  const lookup = (value) => {
    if (!value) return null;
    return choiceState.aliasToKey.get(value) || null;
  };

  const identifiers = [fragment.backendId, fragment.callId, fragment.id, fragment.key];
  for (const candidate of identifiers) {
    const existing = lookup(candidate);
    if (existing) return existing;
  }

  for (const keyName of ID_KEYS) {
    if (fragment.raw && typeof fragment.raw === "object" && fragment.raw[keyName]) {
      const value = fragment.raw[keyName];
      const existing = lookup(value);
      if (existing) return existing;
      if (value) {
        registerAlias(choiceState, value, value);
        return value;
      }
    }
  }

  if (Number.isInteger(fragment.index)) {
    const idxKey = `idx:${fragment.index}`;
    const existing = lookup(idxKey);
    if (existing) return existing;
    return idxKey;
  }

  if (choiceState.order.length === 1) {
    return choiceState.order[0];
  }

  const autoKey = `auto:${choiceState.index}:${choiceState.nextAutoKey++}`;
  return autoKey;
}

function createChoiceState(choiceIndex) {
  return {
    index: choiceIndex,
    callsByKey: new Map(),
    order: [],
    aliasToKey: new Map(),
    textualFingerprints: new Set(),
    nextAutoKey: 0,
  };
}

function appendArgument(callState, fragment) {
  if (typeof fragment.arguments !== "string") return;
  const chunk = fragment.arguments;
  if (fragment.mode === "delta" && chunk === callState.lastFragmentArgs) {
    return false;
  }
  if (fragment.mode === "message" || fragment.replaceArgs) {
    callState.argBuffers = chunk ? [Buffer.from(chunk, "utf8")] : [];
  } else if (chunk) {
    callState.argBuffers.push(Buffer.from(chunk, "utf8"));
  }
  const total = callState.argBuffers.length
    ? Buffer.concat(callState.argBuffers).toString("utf8")
    : "";
  callState.lastFragmentArgs = chunk;
  if (total !== callState.argsText) {
    callState.argsText = total;
    return true;
  }
  return false;
}

function buildDelta(callState) {
  const delta = { index: callState.ordinal };
  let touched = false;

  if (!callState.sentId) {
    delta.id = callState.id;
    callState.sentId = true;
    touched = true;
  }
  if (!callState.sentType && callState.type) {
    delta.type = callState.type;
    callState.sentType = true;
    touched = true;
  }
  if (!callState.sentName && callState.name) {
    delta.function = delta.function || {};
    delta.function.name = callState.name;
    callState.sentName = true;
    touched = true;
  }
  if (callState.argsText && callState.argsText !== callState.lastArgsSnapshot) {
    delta.function = delta.function || {};
    delta.function.arguments = callState.argsText;
    callState.lastArgsSnapshot = callState.argsText;
    touched = true;
  }
  return touched ? cloneDelta(delta) : null;
}

function cloneDelta(delta) {
  if (!delta) return null;
  const cloned = { ...delta };
  if (delta.function && typeof delta.function === "object") {
    cloned.function = { ...delta.function };
  }
  return cloned;
}

function cloneRecord(callState) {
  const fn = {};
  if (callState.name) fn.name = callState.name;
  fn.arguments = callState.argsText || "";
  return {
    id: callState.id,
    type: callState.type || DEFAULT_TYPE,
    function: fn,
  };
}

function buildTextualFingerprint(block) {
  return `${block.indexStart ?? 0}:${block.indexEnd ?? 0}:${block.name || ""}`;
}

function synthesizeTextualCalls(choiceState, text, assignId) {
  if (!text || !choiceState) return [];
  const deltas = [];
  const blocks = runTextPatterns(text, 0);
  blocks.forEach((block) => {
    const fingerprint = buildTextualFingerprint(block);
    if (choiceState.textualFingerprints.has(fingerprint)) return;
    choiceState.textualFingerprints.add(fingerprint);
    const argsText = block.argsText ? block.argsText.trim() : "";
    const callState = createCallState(choiceState, {
      name: block.name || "use_tool",
      arguments: argsText,
      textual: true,
    });
    callState.id = assignId({
      choiceIndex: choiceState.index,
      ordinal: callState.ordinal,
      fragment: { name: block.name || "use_tool" },
    });
    if (argsText) {
      callState.argBuffers = [Buffer.from(argsText, "utf8")];
      callState.argsText = argsText;
      callState.lastArgsSnapshot = "";
    }
    const delta = buildDelta(callState);
    if (delta) {
      deltas.push(delta);
      callState.emitted = true;
    }
  });
  return deltas;
}

function createCallState(choiceState, fragment) {
  const key = fragment.key || `auto:${choiceState.index}:${choiceState.nextAutoKey++}`;
  const ordinal = choiceState.order.length;
  const id = fragment.id || defaultIdFactory({ choiceIndex: choiceState.index, ordinal });
  const callState = {
    key,
    id,
    choiceIndex: choiceState.index,
    ordinal,
    type: fragment.type || DEFAULT_TYPE,
    name: fragment.name || null,
    argBuffers: [],
    argsText: "",
    lastArgsSnapshot: "",
    lastFragmentArgs: null,
    sentId: false,
    sentType: false,
    sentName: false,
    emitted: false,
  };
  choiceState.callsByKey.set(key, callState);
  choiceState.order.push(key);
  registerAlias(choiceState, fragment.backendId, key);
  registerAlias(choiceState, fragment.id, key);
  registerAlias(choiceState, fragment.callId, key);
  return callState;
}

function ensureChoiceState(store, index, { createIfMissing = false } = {}) {
  const numericIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  if (!store.has(numericIndex) && createIfMissing) {
    store.set(numericIndex, createChoiceState(numericIndex));
  }
  return store.get(numericIndex) || null;
}

export function createToolCallAggregator({ idFactory } = {}) {
  const choices = new Map();
  let parallelToolCalls = true;

  const assignId = idFactory && typeof idFactory === "function" ? idFactory : defaultIdFactory;

  const applyFragmentToCall = (choiceState, fragment, controls) => {
    const key = resolveKey(choiceState, fragment);
    let callState = choiceState.callsByKey.get(key);
    if (!callState) {
      callState = createCallState(choiceState, {
        key,
        id: fragment.id,
        name: fragment.name,
        type: fragment.type,
        backendId: fragment.backendId,
        callId: fragment.callId,
      });
      callState.id = assignId({
        choiceIndex: choiceState.index,
        ordinal: callState.ordinal,
        fragment,
      });
    }

    registerAlias(choiceState, fragment.backendId, callState.key);
    registerAlias(choiceState, fragment.id, callState.key);
    registerAlias(choiceState, fragment.callId, callState.key);
    if (Number.isInteger(fragment.index)) {
      registerAlias(choiceState, `idx:${fragment.index}`, callState.key);
    }

    let mutated = false;
    if (fragment.type && fragment.type !== callState.type) {
      callState.type = fragment.type;
      callState.sentType = false;
      mutated = true;
    }
    if (fragment.name && fragment.name !== callState.name) {
      callState.name = fragment.name;
      callState.sentName = false;
      mutated = true;
    }
    if (typeof fragment.arguments === "string") {
      const changed = appendArgument(callState, fragment);
      mutated = mutated || changed;
    }

    const shouldEmit = controls.emit || (controls.fallbackEmit && !callState.emitted);
    if (!shouldEmit) return null;
    const delta = buildDelta(callState);
    if (delta) {
      callState.emitted = true;
      return delta;
    }
    return mutated ? null : null;
  };

  const ingestInternal = (payload, { mode, emit = true, fallbackEmit = false, choiceIndex = 0 } = {}) => {
    const fragments = collectFragments(payload, { mode, choiceIndex });
    const deltas = [];
    let updated = false;
    const choiceState = ensureChoiceState(choices, choiceIndex, {
      createIfMissing: fragments.length > 0 || fallbackEmit,
    });

    if (fragments.length && choiceState) {
      fragments.forEach((fragment) => {
        const delta = applyFragmentToCall(choiceState, fragment, { emit, fallbackEmit });
        if (delta) {
          deltas.push(delta);
          updated = true;
        }
      });
    }

    if (!updated && fallbackEmit && choiceState && choiceState.order.length === 0) {
      const textPayload = extractMetadataText(payload);
      if (textPayload) {
        const textDeltas = synthesizeTextualCalls(choiceState, textPayload, assignId);
        if (textDeltas.length) {
          deltas.push(...textDeltas);
          updated = true;
        }
      }
    }

    if (!detectParallelSupport(payload)) {
      parallelToolCalls = false;
    }

    return { updated, deltas };
  };

  const detectParallelSupport = (payload) => {
    if (!payload || typeof payload !== "object") return true;
    if (payload.parallel_tool_calls === false || payload.parallelToolCalls === false) {
      return false;
    }
    if (Array.isArray(payload)) {
      return payload.every((item) => detectParallelSupport(item));
    }
    for (const value of Object.values(payload)) {
      if (value && typeof value === "object" && !detectParallelSupport(value)) {
        return false;
      }
    }
    return true;
  };

  return {
    ingestDelta(payload, options = {}) {
      return ingestInternal(payload, {
        mode: "delta",
        emit: true,
        fallbackEmit: false,
        choiceIndex: options.choiceIndex ?? 0,
      });
    },
    ingestMessage(payload, options = {}) {
      return ingestInternal(payload, {
        mode: "message",
        emit: false,
        fallbackEmit: Boolean(options.emitIfMissing),
        choiceIndex: options.choiceIndex ?? 0,
      });
    },
    snapshot(options = {}) {
      const choiceIndex = typeof options === "number" ? options : options.choiceIndex ?? 0;
      const choiceState = ensureChoiceState(choices, choiceIndex, { createIfMissing: false });
      if (!choiceState) return [];
      return choiceState.order.map((key) => cloneRecord(choiceState.callsByKey.get(key))).map((record) => ({
        id: record.id,
        type: record.type,
        function: { ...record.function },
      }));
    },
    hasCalls(options = {}) {
      if (typeof options === "number") {
        const choiceState = choices.get(options);
        return !!(choiceState && choiceState.order.length);
      }
      if (typeof options.choiceIndex === "number") {
        const choiceState = choices.get(options.choiceIndex);
        return !!(choiceState && choiceState.order.length);
      }
      for (const choiceState of choices.values()) {
        if (choiceState.order.length) return true;
      }
      return false;
    },
    supportsParallelCalls() {
      return parallelToolCalls;
    },
    resetTurn(choiceIndex) {
      if (choiceIndex === undefined || choiceIndex === null) {
        choices.clear();
        return;
      }
      choices.delete(choiceIndex);
    },
  };
}

export { toObsidianXml } from "./tools/obsidianToolsSpec.ts";
