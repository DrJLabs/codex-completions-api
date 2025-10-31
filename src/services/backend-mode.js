import { config as CFG } from "../config/index.js";

const BACKEND_PROTO = "proto";
const BACKEND_APP_SERVER = "app-server";
const LOG_PREFIX = "[proxy][backend-mode]";

let resolvedMode;
let logged = false;

function resolveBackendMode() {
  if (resolvedMode) return resolvedMode;
  resolvedMode = CFG.PROXY_USE_APP_SERVER ? BACKEND_APP_SERVER : BACKEND_PROTO;
  if (!logged) {
    const flagValue = CFG.PROXY_USE_APP_SERVER ? "true" : "false";
    const message =
      resolvedMode === BACKEND_APP_SERVER
        ? `${LOG_PREFIX} PROXY_USE_APP_SERVER=${flagValue} -> activating app-server backend`
        : `${LOG_PREFIX} PROXY_USE_APP_SERVER=${flagValue} -> defaulting to proto backend`;
    console.log(message);
    logged = true;
  }
  return resolvedMode;
}

export function selectBackendMode() {
  return resolveBackendMode();
}

export function isAppServerMode() {
  return resolveBackendMode() === BACKEND_APP_SERVER;
}

export function isProtoMode() {
  return resolveBackendMode() === BACKEND_PROTO;
}

export { BACKEND_APP_SERVER, BACKEND_PROTO };
