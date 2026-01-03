export const createStreamRuntime = ({ output, toolNormalizer, finishTracker }) => ({
  handleDelta({ choiceIndex, delta }) {
    const normalized = toolNormalizer.ingestDelta(delta);
    finishTracker?.onDelta?.(normalized);
    output.emitDelta(choiceIndex, normalized);
  },
  handleMessage({ choiceIndex, message }) {
    const normalized = toolNormalizer.ingestMessage(message);
    finishTracker?.onMessage?.(normalized);
    output.emitMessage(choiceIndex, normalized);
  },
  handleUsage({ choiceIndex, usage }) {
    output.emitUsage(choiceIndex, usage);
  },
  handleResult({ choiceIndex, finishReason }) {
    finishTracker?.finalize?.(finishReason);
    output.emitFinish(choiceIndex, finishReason);
  },
  handleError({ choiceIndex, error }) {
    output.emitError(choiceIndex, error);
  },
});
