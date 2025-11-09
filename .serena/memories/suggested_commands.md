npm install && npm run start  # run server locally on port 11435
npm run dev                  # dev mode against shim Codex
npm run dev:stack:up         # bring up full dev stack with Traefik + Codex
npm run test:unit            # utils-only unit tests (Vitest)
npm run test:integration     # Express route tests
npm test                     # Playwright e2e (models + chat + SSE)
npm run verify:all           # formatting, lint, unit, integration, e2e
npm run smoke:dev|prod       # curl-based smoke tests per environment
curl -s 127.0.0.1:11435/healthz|jq .  # health check
curl -s 127.0.0.1:11435/v1/models|jq .  # model listing