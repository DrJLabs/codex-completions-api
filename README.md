# Codex Completions API (OpenAI-compatible proxy)

OpenAI Chat Completions-compatible HTTP proxy that shells to Codex CLI, with incremental SSE streaming and output filtering. Designed for Roo Code to treat Codex CLI as a first-class "model" via the OpenAI-Compatible provider path.

## Features
- OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`.
- Incremental SSE streaming matching Chat Completions semantics (role then deltas, `[DONE]`).
- Filters Codex operational lines (diff headers, runner logs) from streamed output.
- Maps `reasoning.effort` → `--reasoning` flag (`low|medium|high|minimal`).
- Non-interactive, read-only Codex exec: `--ask-for-approval never`, `--sandbox read-only`.

## Quick start

- Prereqs: Node >= 18, npm, curl. Codex CLI will be installed if missing.
- One-liner install + systemd user service:

```bash
bash scripts/install.sh
```

This installs to `~/.local/share/codex-openai-proxy`, creates a user service, and runs the proxy at `http://127.0.0.1:11435/v1` with API key `codex-local-secret`.

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

- `model` → `-m <model>`
- `messages[]` → joined into a single prompt with `[role]` prefixes
- `stream: true` → incremental SSE from Codex stdout
- `reasoning.effort` → `--reasoning <effort>`
- Other knobs (temperature, top_p, penalties, max_tokens) are ignored.

## Acceptance criteria

- `GET /healthz` returns `{ ok: true }`.
- `GET /v1/models` lists `gpt-5` by default.
- `POST /v1/chat/completions` with `stream:true` yields SSE with `delta.role` then `delta.content` chunks and a `[DONE]` terminator.
- Codex child invoked as:

```
codex exec --ask-for-approval never --sandbox read-only --config preferred_auth_method="chatgpt" -m gpt-5 "<prompt>"
```

## Notes and failure modes

- If `minimal` reasoning isn’t recognized on your Codex build, set Roo to `High`.
- If Codex stdout is too noisy for your use case, extend the `isModelText()` denylist or set `stream:false`.
- Ensure you’re logged into Codex (`codex login`) if auth is missing.
- On some containerized Linux setups, sandboxing may be limited; the proxy still works with read-only intent.

## Security and .gitignore

Sensitive files such as `.env`, `.npmrc`, and any Codex cache directory (`.codex/`) are ignored by `.gitignore`. The proxy never reads or writes your project files; it runs Codex with `--sandbox read-only` and `--ask-for-approval never`.

## License

UNLICENSED (see repository terms). Do not redistribute without permission.

