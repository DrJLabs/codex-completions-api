import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.PROXY_USE_APP_SERVER;

afterEach(() => {
  if (original === undefined) {
    delete process.env.PROXY_USE_APP_SERVER;
  } else {
    process.env.PROXY_USE_APP_SERVER = original;
  }
  vi.resetModules();
});

describe("backend mode selector", () => {
  it("defaults to app-server when env toggle is unset", async () => {
    delete process.env.PROXY_USE_APP_SERVER;
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    const { selectBackendMode, isAppServerMode, isBackendDisabled, BACKEND_APP_SERVER } =
      await import("../../../src/services/backend-mode.js");

    expect(config.PROXY_USE_APP_SERVER).toBe(true);
    expect(selectBackendMode()).toBe(BACKEND_APP_SERVER);
    expect(isAppServerMode()).toBe(true);
    expect(isBackendDisabled()).toBe(false);
  });

  it("disables app-server when env toggle is explicitly false", async () => {
    process.env.PROXY_USE_APP_SERVER = "false";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    const { selectBackendMode, isAppServerMode, isBackendDisabled, BACKEND_DISABLED } =
      await import("../../../src/services/backend-mode.js");

    expect(config.PROXY_USE_APP_SERVER).toBe(false);
    expect(selectBackendMode()).toBe(BACKEND_DISABLED);
    expect(isAppServerMode()).toBe(false);
    expect(isBackendDisabled()).toBe(true);
  });

  it("activates app-server mode when env toggle is true", async () => {
    process.env.PROXY_USE_APP_SERVER = "true";
    vi.resetModules();
    const { config } = await import("../../../src/config/index.js");
    const { selectBackendMode, isAppServerMode, isBackendDisabled, BACKEND_APP_SERVER } =
      await import("../../../src/services/backend-mode.js");

    expect(config.PROXY_USE_APP_SERVER).toBe(true);
    expect(selectBackendMode()).toBe(BACKEND_APP_SERVER);
    expect(isAppServerMode()).toBe(true);
    expect(isBackendDisabled()).toBe(false);
  });
});
