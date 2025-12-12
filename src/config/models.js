const REASONING_VARIANTS = ["low", "medium", "high", "minimal"];
const DEV_BASE = "codev-5";
const PROD_BASE = "codex-5";
const GPT51_TARGET_MODEL = "gpt-5.1";
const GPT52_TARGET_MODEL = "gpt-5.2";
const GPT51_VARIANTS = [
  { suffix: "L", effort: "low" },
  { suffix: "M", effort: "medium" },
  { suffix: "H", effort: "high" },
];
const GPT52_VARIANTS = [
  { suffix: "L", effort: "low" },
  { suffix: "M", effort: "medium" },
  { suffix: "H", effort: "high" },
  { suffix: "XH", effort: "xhigh" },
];

const buildBaseModels = (base) => [base, ...REASONING_VARIANTS.map((v) => `${base}-${v}`)];

const buildGpt51Models = (isDevEnv) =>
  isDevEnv ? GPT51_VARIANTS.map(({ suffix }) => `codev-5.1-${suffix}`) : [];

const buildGpt52Models = (isDevEnv) =>
  isDevEnv ? GPT52_VARIANTS.map(({ suffix }) => `codev-5.2-${suffix}`) : [];

export function publicModelIds(isDevEnv) {
  const base = isDevEnv ? DEV_BASE : PROD_BASE;
  return [...buildBaseModels(base), ...buildGpt51Models(isDevEnv), ...buildGpt52Models(isDevEnv)];
}

const buildOverrideMaps = () => {
  const target = new Map();
  const reasoning = new Map();
  for (const { suffix, effort } of GPT51_VARIANTS) {
    const key = `codev-5.1-${suffix.toLowerCase()}`;
    target.set(key, GPT51_TARGET_MODEL);
    reasoning.set(key, effort);
  }
  for (const { suffix, effort } of GPT52_VARIANTS) {
    const key = `codev-5.2-${suffix.toLowerCase()}`;
    target.set(key, GPT52_TARGET_MODEL);
    reasoning.set(key, effort);
  }
  return { target, reasoning };
};

const overrides = buildOverrideMaps();
export const MODEL_TARGET_OVERRIDES = overrides.target;
export const MODEL_REASONING_OVERRIDES = overrides.reasoning;

export function acceptedModelIds(defaultModel = "gpt-5") {
  const dev = publicModelIds(true).map((id) => id.toLowerCase());
  const prod = publicModelIds(false).map((id) => id.toLowerCase());
  const normalizedDefault = String(defaultModel || "").toLowerCase();
  const values = [...dev, ...prod];
  if (normalizedDefault) values.push(normalizedDefault);
  return new Set(values);
}

export { REASONING_VARIANTS };
