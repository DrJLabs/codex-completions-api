# codex-cli 0.49.0 proto exits when stdout is not a TTY

## Summary

- After updating the dev stack to `codex-cli 0.49.0`, every real Codex completion routed through the proxy returns the fallback string "No output from backend." instead of streamed model output.
- The proxy successfully spawns `/usr/local/lib/codex-cli/bin/codex.js proto`, but the child process quits immediately, printing `Error: stdout is not a terminal` to stderr and emitting no stdout tokens.
- Because the proxy depends on the CLI's stdout pipe for SSE, the early exit makes all completions fail for clients hitting the dev environment.

## Impact

- Dev stack users (e.g., Obsidian clients pointed at `codex-dev.onemainarmy.com`) receive no assistant responses, degrading the environment's usefulness for validation and debugging.
- Playwright smoke tests and any other automation that expects real completions also fail, since the proxy never receives tokens to stream.
- The production stack is likely unaffected until it upgrades to the same `codex-cli` build, but the breakage blocks testing changes that depend on real Codex output.

## Environment

- Repository: `codex-completions-api` (dev compose stack).
- Compose invocation: `docker compose -p codex-dev -f compose.dev.stack.yml --env-file .env.dev up`.
- Container image: `codex-completions-api:dev` (built from current main).
- Codex CLI version inside container: `codex-cli 0.49.0` (`/usr/local/lib/codex-cli/bin/codex.js --version`).
- Proxy configuration: streaming mode (`PROXY_STREAM_MODE=incremental`) with stdout piped to the Node process (no pseudo-TTY).

## Steps to Reproduce

1. Ensure the dev stack is running (`npm run dev:stack:up` from `codex-completions-api`).
2. Issue a chat completion request, e.g.
   ```sh
   curl -s https://codex-dev.onemainarmy.com/v1/chat/completions \
     -H "Authorization: Bearer $PROXY_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"model":"codev-5-low","stream":true,"messages":[{"role":"user","content":"hello"}]}'
   ```
3. Observe that the client receives only `No output from backend.` instead of streamed tokens.

## Observed Behaviour

- Container logs confirm the proxy spawns the CLI and then emits the fallback content:
  ```
  [proxy] spawning (proto): /usr/local/lib/codex-cli/bin/codex.js proto ...
  [dev][response][chat][stream] content=
  No output from backend.
  ```
- The proto event log captures stderr from the Codex child process:
  ```
  .codev/proto-events.ndjson:1246501 {"kind":"stderr","chunk":"Error: stdout is not a terminal\n"}
  .codev/proto-events.ndjson:1246583 {"kind":"stderr","chunk":"Error: stdout is not a terminal\n"}
  ```
- Manually running the same entrypoint inside the container reproduces the failure:
  ```
  $ docker compose -p codex-dev -f compose.dev.stack.yml --env-file .env.dev exec app-dev /usr/local/lib/codex-cli/bin/codex.js proto
  Error: stdout is not a terminal
  ```

## Expected Behaviour

- `codex.js proto` should stream tokens over stdout regardless of whether stdout is attached to a TTY, allowing the proxy to mediate SSE responses.

## Confirmed Root Cause

- Commit `43b63ccae89cf911c1d3fecc4577a98b898d6048` (“update composer + user message styling”) introduced an explicit TTY guard inside `codex-rs/tui/src/tui.rs:127`:
  - `if !stdout().is_terminal() { return Err(std::io::Error::other("stdout is not a terminal")); }`
- `codex proto` still boots the interactive TUI stack via `codex-rs/tui/src/lib.rs:290`, so when the proxy launches the CLI with stdout piped, the guard triggers immediately, reproducing the stderr seen in stack logs and causing the child process to exit before emitting tokens.
- Releases ≤0.48.x did not include this check, which is why the proxy worked prior to the 0.49 upgrade.

## Recommended Solution: Migrate the Proxy to `codex app-server`

- The Rust CLI exposes `codex app-server`, a headless stdio JSON-RPC interface used by first-party integrations (see `codex-rs/cli/src/main.rs:376` and `codex-rs/app-server/src/lib.rs`).
- Unlike `proto`, the app server does not require a TTY; it is designed for piping and already drives the VS Code extension, making it the stable contract for external clients.
- Switching the proxy to this entrypoint decouples us from TUI-specific assumptions and avoids future regressions when the CLI evolves its interactive UI.

### Implementation Plan

1. **Spawn the app server:** invoke `/usr/local/lib/codex-cli/bin/codex.js app-server` with stdout/stderr captured. No pty shim is required.
2. **Perform the bootstrap handshake** (mirrors `codex-rs/app-server/tests/common/mcp_process.rs`):
   - Send the JSON-RPC `initialize` request with client metadata and wait for the response.
   - Emit the `client/initialized` notification so the server begins processing work.
3. **Create or resume conversations:** call `newConversation` (or `resumeConversation`) to obtain a `conversationId` for each user session.
4. **Subscribe to streaming updates:** issue `addConversationListener` for the conversation and translate the resulting `codex/event/*` notifications into SSE events. Key notifications include `codex/event/task_started`, `codex/event/raw_response_item` (streamed deltas when opted in), and `codex/event/task_complete`.
5. **Send user requests:** forward user prompts via `sendUserMessage`/`sendUserTurn` with the collected input items.
6. **Handle auxiliary flows:**
   - Auth updates arrive via `authStatusChange` notifications—propagate them to clients as today.
   - Continue to surface rate-limit telemetry (`account/rateLimits/updated`) if the proxy depends on it.
7. **Shutdown semantics:** close the proxy’s stdin handle to terminate the app server gracefully once all work completes; it mirrors the lifecycle already covered by `codex-rs/app-server/src/lib.rs:145-170`.

### Fallbacks & Transitional Mitigations

- **Immediate unblock (if needed):**
  - Pin the container to `codex-cli 0.48.x`, or
  - Wrap the existing `proto` invocation in a pseudo-TTY (e.g. `node-pty`, `script -qfec ...`) until the migration lands.
- These should remain temporary; relying on the interactive TUI path will keep breaking as the CLI continues to evolve.

### Migration Checklist

- [ ] Implement an app-server client inside the proxy with the handshake, conversation, and subscription flow above.
- [ ] Map JSON-RPC notifications to existing SSE payloads; add regression tests that enforce the contract against a live `codex app-server` subprocess.
- [ ] Update deployment artifacts (Docker image, compose stack) to launch the new entrypoint and expose any required configuration.
- [ ] Document the new dependency in the dev stack readme and note the minimum `codex-cli` version that includes the app server.
- [ ] Remove the pseudo-TTY or version pin once the migration has been verified in staging.

## Mitigation Options

1. **Short term:** Pin the dev stack back to a pre-0.49 Codex CLI release (e.g., 0.48.x) or temporarily point `CODEX_BIN` to `scripts/fake-codex-proto.js` so the environment remains usable while the real fix is developed.
2. **Medium term:** Update the proxy launcher to provide a pseudo-TTY (e.g., spawn via `node-pty` or `script -qfec ...`) or migrate to a machine-oriented entrypoint if Codex exposes one that supports pipes.
3. **Long term:** Coordinate with the Codex CLI team to expose a configuration knob that permits non-TTY stdout for server integrations, so future upgrades do not break proxy deployments.

## Open Questions

- Is there an undocumented CLI flag or config key that relaxes the TTY requirement in 0.49.0?
- Does the CLI offer an alternative streaming interface (e.g., `codex app-server`) better suited for proxies?
- Was this behaviour called out in release notes, and should the proxy pin CLI versions until compatibility is guaranteed?

## References

- Dev stack logs: `docker compose -p codex-dev -f compose.dev.stack.yml --env-file .env.dev logs app-dev`.
- Proto event trace: `.codev/proto-events.ndjson` in the `codex-completions-api` workspace.
- Manual repro command: `docker compose ... exec app-dev /usr/local/lib/codex-cli/bin/codex.js proto`.
