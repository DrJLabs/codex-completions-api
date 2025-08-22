# Codex Completions API (OpenAI-compatible proxy)

OpenAI Chat Completions-compatible HTTP proxy that shells to Codex CLI, with SSE streaming compatibility and minimal output shaping. Designed for Roo Code to treat Codex CLI as a first-class "model" via the OpenAI-Compatible provider path.

## Features
- OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`.
- SSE streaming compatibility: emits an initial `delta.role=assistant` chunk, then a single content chunk (aggregated Codex stdout) and `[DONE]`.
- Minimal output shaping: ANSI is stripped; additional heuristics exist but are conservative by default to avoid dropping valid content.
- Reasoning effort mapping: `reasoning.effort` → `--config reasoning.effort="<low|medium|high|minimal>"` (silently ignored by older builds).
- Safety: Codex runs with `--sandbox read-only`. Approval flags are not passed to `exec` (see Notes).

## Quick start

- Prereqs: Node >= 18, npm, curl. Codex CLI will be installed if missing.
- One-liner install + systemd user service:

```bash
bash scripts/install.sh
```

This installs to `~/.local/share/codex-openai-proxy`, creates a user service, and runs the proxy at `http://127.0.0.1:11435/v1` with API key `codex-local-secret`.
If port `11435` is already in use, override with `PORT=18000 npm run start` (and use `BASE_URL=http://127.0.0.1:18000/v1` in tests).

## Local development

```bash
npm install
npm run start
# In another shell
bash scripts/smoke.sh
```

Environment variables:
- `PORT` (default: `11435`)
- `PROXY_API_KEY` (default: `codex-local-secret`)
- `CODEX_MODEL` (default: `gpt-5`)
- `PROXY_STREAM_MODE` (default: `incremental`)
- `CODEX_BIN` (default: `codex`)

## Roo Code configuration

Use OpenAI-Compatible provider:
- Base URL: `http://127.0.0.1:11435/v1`
- API Key: `codex-local-secret`
- Model: `gpt-5`
- Reasoning effort: `High`

An example file is in `config/roo-openai-compatible.json`.

## API mapping

- `model`: passthrough to `-m <model>`.
- `messages[]`: joined into a single positional prompt with `[role]` prefixes.
- `stream: true`: SSE role-first chunk, then one aggregated content chunk on process close, then `[DONE]`.
  - Upgrade path: parse `codex exec --json` events to emit true incremental chunks.
- `reasoning.effort ∈ {low,medium,high,minimal}`: attempts `--config reasoning.effort="<effort>"`.
- Other knobs (temperature, top_p, penalties, max_tokens): ignored.

## Acceptance criteria

- `GET /healthz` returns `{ ok: true }`.
- `GET /v1/models` lists `gpt-5` by default.
- `POST /v1/chat/completions` with `stream:true` yields SSE with a role-first chunk and a `[DONE]` terminator (content chunk may arrive aggregated before `[DONE]`).
- Codex child invoked as:

```
codex exec --sandbox read-only --config preferred_auth_method="chatgpt" -m gpt-5 [--config reasoning.effort="high"] "<prompt>"
```

## Notes and troubleshooting

- Approval flag: `codex exec` does not accept `--ask-for-approval`. The proxy relies on `exec`'s non-interactive behavior and your Codex defaults. If you need to enforce approvals globally, configure them in `~/.codex/config.toml`.
- Reasoning effort: Some versions may ignore `--config reasoning.effort=...`. Use Roo’s “High” if unsure.
- Port already in use: If `11435` is busy, launch with `PORT=18000 npm run start` and run acceptance with `BASE_URL=http://127.0.0.1:18000/v1`.
- Streaming shape: Immediate role chunk is emitted to satisfy Chat Completions SSE clients. Content is currently aggregated into a single chunk; move to `--json` parsing for true token-by-token streaming.
- Auth: Ensure you’re logged into Codex (`codex login`).
- Sandboxing: On some containerized Linux setups, sandboxing may be limited; read-only intent remains.

## Security and .gitignore

Sensitive files such as `.env`, `.npmrc`, and any Codex cache directory (`.codex/`) are ignored by `.gitignore`. The proxy never reads or writes your project files; it runs Codex with `--sandbox read-only`.

## Running acceptance

You can run the acceptance checks locally (requires Codex installed and logged in):

```bash
# Default port
bash scripts/acceptance.sh

# Alternate port if 11435 is in use
PORT=18000 npm run start &
BASE_URL=http://127.0.0.1:18000/v1 bash scripts/acceptance.sh
```

The acceptance checks look for a role-first SSE chunk and the `[DONE]` terminator. Content may arrive as one aggregated chunk prior to `[DONE]`.

## License

UNLICENSED (see repository terms). Do not redistribute without permission.
