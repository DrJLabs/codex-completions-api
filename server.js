import { config as CFG } from "./src/config/index.js";
import { selectBackendMode, isAppServerMode } from "./src/services/backend-mode.js";
import createApp from "./src/app.js";
import { ensureWorkerSupervisor } from "./src/services/worker/supervisor.js";
import { getJsonRpcTransport } from "./src/services/transport/index.js";
import { assertSecureConfig } from "./src/services/security-check.js";
import { normalizeIp } from "./src/lib/net.js";

// Thin bootstrap only. All routing and business logic reside under src/.
assertSecureConfig(CFG, process.env);
selectBackendMode();
const SUPERVISOR_ENABLED = isAppServerMode();
const supervisor = SUPERVISOR_ENABLED ? ensureWorkerSupervisor() : null;
let transport = null;
if (SUPERVISOR_ENABLED) {
  try {
    transport = getJsonRpcTransport();
    transport
      .ensureHandshake()
      .catch((err) =>
        console.error("[proxy][bootstrap] JSON-RPC handshake failed during startup", err)
      );
  } catch (err) {
    console.error("[proxy][bootstrap] Failed to initialize JSON-RPC transport", err);
  }
}
const app = createApp();
const PORT = CFG.PORT;
const HOST = CFG.PROXY_HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  const address = server.address();
  const hostForLog =
    typeof address === "string" ? address : `${normalizeIp(address.address)}:${address.port}`;
  console.log(`codex-openai-proxy listening on http://${hostForLog}/v1`);
});

// Graceful shutdown on SIGTERM/SIGINT
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const exitClean = (code = 0) => {
      try {
        server.close?.(() => process.exit(code));
      } catch (err) {
        console.error("Error during graceful shutdown:", err);
        process.exit(1);
      }
    };
    if (supervisor) {
      supervisor
        .shutdown({ signal: sig, reason: "process_signal" })
        .then(() => exitClean(0))
        .catch((err) => {
          console.error("Supervisor shutdown error:", err);
          exitClean(1);
        });
    } else {
      exitClean(0);
    }
  });
}

export default server;
