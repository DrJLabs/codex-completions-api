/**
 * Creates a controller that enforces the Stop-After-Tools behavior for streaming
 * responses. The controller keeps track of whether a cutoff already happened and
 * exposes a `schedule(choiceIndex)` API that callers can invoke whenever a tool
 * call is forwarded for a specific choice.
 */
export function createStopAfterToolsController({
  enforce = false,
  stopAfterToolsMode = "burst",
  stopAfterToolsMax = 0,
  graceMs = 300,
  getTotalForwardedToolCount = () => 0,
  getChoiceForwardedToolCount = () => 0,
  onCutoff = () => {},
} = {}) {
  let timer = null;
  let stopped = false;

  const clearTimer = () => {
    if (!timer) return;
    try {
      clearTimeout(timer);
    } catch {}
    timer = null;
  };

  const cutNow = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    try {
      onCutoff();
    } catch {}
  };

  const normalizeCount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const schedule = (choiceIndex = null) => {
    if (!enforce || stopped) return;
    const totalForwarded = normalizeCount(getTotalForwardedToolCount?.());
    if (totalForwarded <= 0) return;

    const hasChoice = Number.isInteger(choiceIndex) && choiceIndex >= 0;
    const choiceCount = hasChoice
      ? normalizeCount(getChoiceForwardedToolCount?.(choiceIndex))
      : null;

    const perChoiceExceeded =
      stopAfterToolsMax > 0 && choiceCount !== null && choiceCount > stopAfterToolsMax;
    const fallbackExceeded =
      stopAfterToolsMax > 0 && choiceCount === null && totalForwarded > stopAfterToolsMax;

    if (stopAfterToolsMode === "first" || perChoiceExceeded || fallbackExceeded) {
      cutNow();
      return;
    }

    clearTimer();
    timer = setTimeout(cutNow, Math.max(0, graceMs));
  };

  const cancel = () => {
    clearTimer();
  };

  return {
    schedule,
    cancel,
    forceCut: cutNow,
    hasStopped: () => stopped,
  };
}

export default createStopAfterToolsController;
