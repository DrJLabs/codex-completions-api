Project-local Codex config for development.

Usage (Node dev on port 18000):

  PROXY_API_KEY=<your-dev-key> \
  PORT=18000 \
  CODEX_HOME="$(pwd)/.codev" \
  npm run start

Or use the npm script added by this branch:

  PROXY_API_KEY=<your-dev-key> npm run start:codev

To run without a real Codex CLI (uses the built-in proto shim):

  PROXY_API_KEY=<your-dev-key> npm run start:codev:shim

Do not put secrets in this folder. Only `AGENTS.md` and `config.toml` are tracked.
