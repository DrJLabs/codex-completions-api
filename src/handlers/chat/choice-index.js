const toChoiceIndex = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const extractChoiceIndex = (candidate, visited = new WeakSet()) => {
  if (!candidate || typeof candidate !== "object") return null;
  if (visited.has(candidate)) return null;
  visited.add(candidate);
  if (Object.prototype.hasOwnProperty.call(candidate, "choice_index")) {
    const idx = toChoiceIndex(candidate.choice_index);
    if (idx !== null) return idx;
  }
  if (Object.prototype.hasOwnProperty.call(candidate, "choiceIndex")) {
    const idx = toChoiceIndex(candidate.choiceIndex);
    if (idx !== null) return idx;
  }
  const nestedSources = [candidate.msg, candidate.message, candidate.delta, candidate.payload];
  for (const source of nestedSources) {
    const resolved = extractChoiceIndex(source, visited);
    if (resolved !== null) return resolved;
  }
  if (Array.isArray(candidate.choices)) {
    for (const choice of candidate.choices) {
      const resolved = extractChoiceIndex(choice, visited);
      if (resolved !== null) return resolved;
    }
  }
  return null;
};

export const resolveChoiceIndexFromPayload = (...candidates) => {
  for (const candidate of candidates) {
    const idx = extractChoiceIndex(candidate);
    if (idx !== null) return idx;
  }
  return 0;
};
