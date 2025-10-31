import { config as CFG } from "./src/config/index.js";
import { selectBackendMode } from "./src/services/backend-mode.js";
import createApp from "./src/app.js";

// Thin bootstrap only. All routing and business logic reside under src/.
selectBackendMode();
const app = createApp();
const PORT = CFG.PORT;

const server = app.listen(PORT, () => {
  console.log(`codex-openai-proxy listening on http://127.0.0.1:${PORT}/v1`);
});

// Graceful shutdown on SIGTERM/SIGINT
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    try {
      server.close?.(() => process.exit(0));
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  });
}

export default server;
