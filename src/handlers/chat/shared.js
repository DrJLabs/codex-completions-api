export function buildProtoArgs({
  SANDBOX_MODE,
  effectiveModel,
  FORCE_PROVIDER,
  reasoningEffort,
  allowEffort,
}) {
  const args = [
    "proto",
    "--config",
    'preferred_auth_method="chatgpt"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    'history.persistence="none"',
    "--config",
    "tools.web_search=false",
    "--config",
    `sandbox_mode="${SANDBOX_MODE}"`,
    "--config",
    `model="${effectiveModel}"`,
  ];
  if (FORCE_PROVIDER) args.push("--config", `model_provider="${FORCE_PROVIDER}"`);
  if (allowEffort?.has?.(reasoningEffort)) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push("--config", `reasoning.effort="${reasoningEffort}"`);
  }
  return args;
}
