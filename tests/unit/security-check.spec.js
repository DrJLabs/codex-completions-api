import { describe, expect, it } from "vitest";
import { assertSecureConfig } from "../../src/services/security-check.js";

const baseCfg = {
  API_KEY: "test-key",
  PROXY_ENV: "prod",
  PROXY_ENABLE_METRICS: false,
  PROXY_METRICS_TOKEN: "",
  PROXY_METRICS_ALLOW_UNAUTH: false,
  PROXY_TEST_ENDPOINTS: false,
};

describe("assertSecureConfig", () => {
  it("throws when API key is default in prod-like env", () => {
    expect(() =>
      assertSecureConfig({ ...baseCfg, API_KEY: "codex-local-secret" }, { NODE_ENV: "production" })
    ).toThrow(/API_KEY/);
  });

  it("throws when test endpoints are enabled in prod-like env", () => {
    expect(() =>
      assertSecureConfig({ ...baseCfg, PROXY_TEST_ENDPOINTS: true }, { NODE_ENV: "production" })
    ).toThrow(/PROXY_TEST_ENDPOINTS/);
  });

  it("throws when metrics are unauthenticated in prod-like env", () => {
    expect(() =>
      assertSecureConfig(
        {
          ...baseCfg,
          PROXY_ENABLE_METRICS: true,
          PROXY_METRICS_ALLOW_UNAUTH: true,
          PROXY_METRICS_TOKEN: "",
        },
        { NODE_ENV: "production" }
      )
    ).toThrow(/METRICS_AUTH/);
  });

  it("does not throw in dev env (even when NODE_ENV=production)", () => {
    expect(() =>
      assertSecureConfig(
        { ...baseCfg, API_KEY: "codex-local-secret", PROXY_ENV: "dev" },
        { NODE_ENV: "production" }
      )
    ).not.toThrow();
  });
});
