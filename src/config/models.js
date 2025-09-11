const REASONING_VARIANTS = ["low", "medium", "high", "minimal"];

export function publicModelIds(isDevEnv) {
  const base = isDevEnv ? "codev-5" : "codex-5";
  return [base, ...REASONING_VARIANTS.map((v) => `${base}-${v}`)];
}

export function acceptedModelIds(defaultModel = "gpt-5") {
  const dev = publicModelIds(true);
  const prod = publicModelIds(false);
  return new Set([...dev, ...prod, defaultModel]);
}

export { REASONING_VARIANTS };
