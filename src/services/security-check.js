const DEFAULT_API_KEY = "codex-local-secret";

const isProdLike = (cfg, env = process.env) => {
  const envName = (cfg.PROXY_ENV || "").toLowerCase();
  if (String(env.NODE_ENV || "").toLowerCase() === "production") return true;
  if (!envName) return false;
  return envName !== "dev" && envName !== "development";
};

export function assertSecureConfig(cfg, env = process.env) {
  if (!isProdLike(cfg, env)) return;
  const issues = [];
  if (!cfg.API_KEY || cfg.API_KEY === DEFAULT_API_KEY) {
    issues.push("API_KEY");
  }
  if (cfg.PROXY_TEST_ENDPOINTS) {
    issues.push("PROXY_TEST_ENDPOINTS");
  }
  const metricsInsecure =
    cfg.PROXY_ENABLE_METRICS &&
    (cfg.PROXY_METRICS_ALLOW_UNAUTH === true ||
      (!cfg.PROXY_METRICS_ALLOW_LOOPBACK && !cfg.PROXY_METRICS_TOKEN));
  if (metricsInsecure) {
    issues.push("METRICS_AUTH");
  }
  if (issues.length > 0) {
    const err = new Error(
      `Unsafe production configuration: ${issues.join(
        ", "
      )}. Set PROXY_ENV=dev for local, or supply secure values.`
    );
    err.code = "CONFIG_INSECURE";
    throw err;
  }
}
