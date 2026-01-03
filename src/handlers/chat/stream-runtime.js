export const createStreamRuntime = ({ output, toolNormalizer, finishTracker }) => ({
  handleDelta({ choiceIndex, delta, ...context }) {
    const normalized = toolNormalizer.ingestDelta(delta);
    finishTracker?.onDelta?.(normalized);
    output.emitDelta(choiceIndex, normalized, context);
  },
  handleMessage({ choiceIndex, message, ...context }) {
    const normalized = toolNormalizer.ingestMessage(message);
    finishTracker?.onMessage?.(normalized);
    output.emitMessage(choiceIndex, normalized, context);
  },
  handleUsage({ choiceIndex, usage, ...context }) {
    output.emitUsage(choiceIndex, usage, context);
  },
  handleResult({ choiceIndex, finishReason, ...context }) {
    finishTracker?.finalize?.(finishReason);
    output.emitFinish(choiceIndex, finishReason, context);
  },
  handleError({ choiceIndex, error, ...context }) {
    output.emitError(choiceIndex, error, context);
  },
});
