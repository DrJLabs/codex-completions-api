const normalizeLabels = (input = {}) => {
  const entries = Object.entries(input || {})
    .filter(([key]) => typeof key === "string" && key.length)
    .map(([key, value]) => [key, String(value ?? "")]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
};

const createCounter = (name) => {
  let total = 0;
  const buckets = new Map();

  const increment = (labels = {}) => {
    const normalized = normalizeLabels(labels);
    const key = JSON.stringify(normalized);
    const existing = buckets.get(key) || { labels: normalized, value: 0 };
    existing.value += 1;
    buckets.set(key, existing);
    total += 1;
  };

  const snapshot = () => ({
    name,
    total,
    buckets: Array.from(buckets.values()).map((entry) => ({
      labels: entry.labels,
      value: entry.value,
    })),
  });

  const reset = () => {
    total = 0;
    buckets.clear();
  };

  return { increment, snapshot, reset };
};

const startedCounter = createCounter("codex_tool_buffer_started_total");
const flushedCounter = createCounter("codex_tool_buffer_flushed_total");
const abortedCounter = createCounter("codex_tool_buffer_aborted_total");

export const toolBufferMetrics = {
  start(labels = {}) {
    startedCounter.increment(labels);
  },
  flush(labels = {}) {
    flushedCounter.increment(labels);
  },
  abort(labels = {}) {
    abortedCounter.increment(labels);
  },
  summary() {
    return {
      started: startedCounter.snapshot(),
      flushed: flushedCounter.snapshot(),
      aborted: abortedCounter.snapshot(),
    };
  },
  reset() {
    startedCounter.reset();
    flushedCounter.reset();
    abortedCounter.reset();
  },
};

export default toolBufferMetrics;
