import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const configMock = {
  PROTECT_MODELS: false,
  API_KEY: "secret",
  PROXY_ENABLE_CORS: "true",
  PROXY_CORS_ALLOWED_ORIGINS: "*",
  PROXY_ENV: "prod",
};

const publicModelIdsMock = vi.fn();
const applyCorsMock = vi.fn();
const authErrorBodyMock = vi.fn();

vi.mock("../../src/config/index.js", () => ({
  config: configMock,
}));

vi.mock("../../src/config/models.js", () => ({
  publicModelIds: (...args) => publicModelIdsMock(...args),
}));

vi.mock("../../src/utils.js", () => ({
  applyCors: (...args) => applyCorsMock(...args),
}));

vi.mock("../../src/lib/errors.js", () => ({
  authErrorBody: () => authErrorBodyMock(),
}));

const startApp = async () => {
  const { default: modelsRouter } = await import("../../src/routes/models.js");
  const app = express();
  app.use(modelsRouter());
  const server = app.listen(0);
  const port = server.address().port;
  return { server, port };
};

beforeEach(() => {
  configMock.PROTECT_MODELS = false;
  configMock.API_KEY = "secret";
  configMock.PROXY_ENABLE_CORS = "true";
  configMock.PROXY_CORS_ALLOWED_ORIGINS = "*";
  configMock.PROXY_ENV = "prod";
  publicModelIdsMock.mockReset().mockReturnValue(["gpt-test-1"]);
  applyCorsMock.mockReset();
  authErrorBodyMock.mockReset().mockReturnValue({ ok: false });
});

afterEach(() => {
  vi.resetModules();
});

describe("models router", () => {
  it("returns model list when unprotected", async () => {
    configMock.PROTECT_MODELS = false;
    publicModelIdsMock.mockReturnValue(["gpt-test-1", "gpt-test-2"]);
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(body).toEqual({
      object: "list",
      data: [
        { id: "gpt-test-1", object: "model", owned_by: "codex", created: 0 },
        { id: "gpt-test-2", object: "model", owned_by: "codex", created: 0 },
      ],
    });
  });

  it("rejects unauthorized access when protected", async () => {
    configMock.PROTECT_MODELS = true;
    authErrorBodyMock.mockReturnValue({ error: "nope" });
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    const body = await res.json();
    server.close();

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer realm=api");
    expect(body).toEqual({ error: "nope" });
  });

  it("allows authorized access and responds to HEAD", async () => {
    configMock.PROTECT_MODELS = true;
    publicModelIdsMock.mockReturnValue(["gpt-test-1"]);
    vi.resetModules();

    const { server, port } = await startApp();
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: "Bearer secret" },
    });
    const headRes = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      method: "HEAD",
      headers: { Authorization: "Bearer secret" },
    });
    server.close();

    expect(res.status).toBe(200);
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-type")).toContain("application/json");
  });
});
