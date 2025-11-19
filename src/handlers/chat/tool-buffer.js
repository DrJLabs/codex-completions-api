const TOOL_OPEN = "<use_tool";
const TOOL_CLOSE = "</use_tool>";

export const createToolBufferTracker = () => ({
  active: null,
  searchPos: 0,
  skipUntil: 0,
});

const resolveSearchStart = (tracker, forwardedUpTo) => {
  if (!tracker) return Math.max(forwardedUpTo, 0);
  const base = Number.isInteger(tracker.searchPos) ? tracker.searchPos : 0;
  return Math.max(base, forwardedUpTo, 0);
};

export const trackToolBufferOpen = (tracker, emitted, forwardedUpTo = 0) => {
  if (!tracker || tracker.active) return -1;
  const text = typeof emitted === "string" ? emitted : "";
  if (!text.includes(TOOL_OPEN)) return -1;
  const startFrom = resolveSearchStart(tracker, forwardedUpTo);
  const candidate = text.indexOf(TOOL_OPEN, startFrom);
  if (candidate >= 0 && candidate >= forwardedUpTo) {
    tracker.active = {
      start: candidate,
      nestedScanPos: candidate + TOOL_OPEN.length,
    };
    tracker.searchPos = candidate + TOOL_OPEN.length;
    return candidate;
  }
  tracker.searchPos = Math.max(text.length - TOOL_OPEN.length, startFrom);
  return -1;
};

export const detectNestedToolBuffer = (tracker, emitted) => {
  if (!tracker?.active) return -1;
  const text = typeof emitted === "string" ? emitted : "";
  const closeIdx = text.indexOf(TOOL_CLOSE, tracker.active.start);
  const scanFrom =
    typeof tracker.active.nestedScanPos === "number"
      ? tracker.active.nestedScanPos
      : tracker.active.start + TOOL_OPEN.length;
  const nestedIdx = text.indexOf(TOOL_OPEN, scanFrom);
  if (nestedIdx >= 0 && (closeIdx < 0 || nestedIdx < closeIdx)) {
    tracker.active.nestedScanPos = nestedIdx;
    return nestedIdx;
  }
  tracker.active.nestedScanPos = Math.max(text.length - TOOL_OPEN.length, scanFrom);
  return -1;
};

export const clampEmittableIndex = (
  tracker,
  forwardedUpTo,
  candidate,
  lastToolEnd,
  suppressTail
) => {
  let allowUntil = candidate;
  if (suppressTail && lastToolEnd >= 0) {
    allowUntil = Math.min(allowUntil, lastToolEnd);
  }
  if (tracker?.active && tracker.active.start >= forwardedUpTo) {
    allowUntil = Math.min(allowUntil, tracker.active.start);
  }
  return allowUntil;
};

export const completeToolBuffer = (tracker, boundary) => {
  if (!tracker) return;
  tracker.skipUntil = Math.max(tracker.skipUntil || 0, boundary || 0);
  tracker.searchPos = Math.max(boundary || 0, tracker.searchPos || 0);
  tracker.active = null;
};

export const abortToolBuffer = (tracker, emitted) => {
  if (!tracker?.active) return { literal: "", start: -1 };
  const text = typeof emitted === "string" ? emitted : "";
  const literal = text.slice(tracker.active.start);
  const start = tracker.active.start;
  tracker.skipUntil = text.length;
  tracker.searchPos = text.length;
  tracker.active = null;
  return { literal, start };
};

export const shouldSkipBlock = (tracker, blockEnd) =>
  Number.isInteger(tracker?.skipUntil) && blockEnd <= tracker.skipUntil;
