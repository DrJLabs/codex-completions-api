import { config as CFG } from "./src/config/index.js";
import { selectBackendMode, isAppServerMode } from "./src/services/backend-mode.js";
import createApp from "./src/app.js";
import { ensureWorkerSupervisor } from "./src/services/worker/supervisor.js";

// Thin bootstrap only. All routing and business logic reside under src/.
selectBackendMode();
const SUPERVISOR_ENABLED = isAppServerMode();
const supervisor = SUPERVISOR_ENABLED ? ensureWorkerSupervisor() : null;
const app = createApp();
const PORT = CFG.PORT;

const server = app.listen(PORT, () => {
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
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
