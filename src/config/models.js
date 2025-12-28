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

const GPT52_CODEV_ALIASES = GPT52_VARIANTS.map(({ suffix, effort }) => ({
  publicId: `gpt-5.2-codev-${suffix}`,
  alias: `gpt-5.2-codev-${suffix.toLowerCase()}`,
  effort,
}));
const GPT52_CODEX_ALIASES = GPT52_VARIANTS.map(({ suffix, effort }) => ({
  publicId: `gpt-5.2-codex-${suffix}`,
  alias: `gpt-5.2-codex-${suffix.toLowerCase()}`,
  effort,
}));
const GPT52_ALIASES = GPT52_VARIANTS.map(({ suffix, effort }) => ({
  alias: `gpt-5.2-${suffix.toLowerCase()}`,
  effort,
}));

const buildBaseModels = (base) => [base, ...REASONING_VARIANTS.map((v) => `${base}-${v}`)];

const buildGpt51Models = (isDevEnv) =>
  isDevEnv ? GPT51_VARIANTS.map(({ suffix }) => `codev-5.1-${suffix}`) : [];

const buildGpt52Models = (isDevEnv) =>
  isDevEnv ? GPT52_VARIANTS.map(({ suffix }) => `codev-5.2-${suffix}`) : [];

export function publicModelIds(isDevEnv) {
  const base = isDevEnv ? DEV_BASE : PROD_BASE;
  const models = [
    ...buildBaseModels(base),
    ...buildGpt51Models(isDevEnv),
    ...buildGpt52Models(isDevEnv),
  ];
  if (isDevEnv) {
    models.push(...GPT52_CODEV_ALIASES.map(({ publicId }) => publicId));
  } else {
    models.push(...GPT52_CODEX_ALIASES.map(({ publicId }) => publicId));
  }
  return models;
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
  for (const { alias, effort } of [
    ...GPT52_CODEV_ALIASES,
    ...GPT52_CODEX_ALIASES,
    ...GPT52_ALIASES,
  ]) {
    target.set(alias, GPT52_TARGET_MODEL);
    reasoning.set(alias, effort);
  }
  return { target, reasoning };
};

const overrides = buildOverrideMaps();
export const MODEL_TARGET_OVERRIDES = overrides.target;
export const MODEL_REASONING_OVERRIDES = overrides.reasoning;

export function acceptedModelIds(defaultModel = "gpt-5.2") {
  const dev = publicModelIds(true).map((id) => id.toLowerCase());
  const prod = publicModelIds(false).map((id) => id.toLowerCase());
  const normalizedDefault = String(defaultModel || "").toLowerCase();
  const values = [
    ...dev,
    ...prod,
    ...GPT52_CODEV_ALIASES.map(({ alias }) => alias),
    ...GPT52_CODEX_ALIASES.map(({ alias }) => alias),
    ...GPT52_ALIASES.map(({ alias }) => alias),
  ];
  if (normalizedDefault) values.push(normalizedDefault);
  return new Set(values);
}

export { REASONING_VARIANTS };
