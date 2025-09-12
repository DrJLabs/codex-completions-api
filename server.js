import { config as CFG } from "./src/config/index.js";
import createApp from "./src/app.js";

// Thin bootstrap only. All routing and business logic reside under src/.
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
      try {
        console.error("Error during graceful shutdown:", err);
      } catch {}
      process.exit(1);
    }
  });
}

export default server;
