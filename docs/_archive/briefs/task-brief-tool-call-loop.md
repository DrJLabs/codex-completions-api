# Task Brief: Complete Tool-Calling Loop Without Placeholders

## Background

Story 2.12 aligned the proxy with OpenAI’s function-calling contract, but the final step—removing the placeholder tool executor—introduced a regression. Codex App Server now waits indefinitely for a `function_call_output`, so `/v1/chat/completions` requests that emit tool calls never complete when the client does not immediately replay tool results. Copilot (and other OpenAI-compatible clients) expect the first response to finish with `finish_reason:"tool_calls"` while their side runs the tool and issues a follow-up request containing `role:"tool"`. We must restore that behaviour without reintroducing the placeholder.

## Objective

Deliver a proxy that mirrors OpenAI’s tool-calling semantics exactly:

1. The first response stops as soon as every tool call has fully streamed its arguments, with `finish_reason:"tool_calls"` for both streaming and non-streaming requests.
2. The proxy cleanly tears down the Codex worker after issuing that response (no lingering stdout that can resume the turn).
3. Follow-up requests containing `role:"tool"` messages replay those payloads to Codex via JSON-RPC `function_call_output` and the conversation proceeds to completion (`finish_reason:"stop"` or similar).
4. Parity fixtures, integration tests, telemetry, and documentation all reflect the new contract.

## Scope & Deliverables

### Engineering Tasks

- **Streaming handler (`src/handlers/chat/stream.js`):**
  - Detect when all tool calls have complete JSON arguments.
  - Emit the empty delta with `finish_reason:"tool_calls"` immediately.
  - Flush usage, write `[DONE]`, mark the request finished, and terminate the Codex child for that turn.
  - Log telemetry (`tool_cutoff`) so operations can monitor occurrences.

- **Non-stream handler (`src/handlers/chat/nonstream.js`):**
  - Build a canonical response with `message.tool_calls`, `message.content: null`, `finish_reason:"tool_calls"`, and accurate usage numbers.
  - Kill the Codex child for that turn to avoid additional output.

- **JSON-RPC transport (`src/services/transport/index.js` & `child-adapter.js`):**
  - Remove assumptions that a non-stream turn must wait for tool results.
  - Ensure contexts resolve when we cut the worker, even if `pendingToolResponses` > 0.
  - Confirm that follow-up requests enqueue client tool output (already in place) and that the context transitions back to normal once Codex replies.

- **Fake Codex shims & parity assets:**
  - Update `scripts/fake-codex-{proto,jsonrpc}.js` to emit tool deltas that make it obvious if the proxy fails to cut the worker.
  - Regenerate transcripts (`npm run transcripts:generate`) to capture the new finish_reason ordering.

- **Tests:**
  - Extend integration suites (e.g., `tests/integration/chat-jsonrpc.int.test.js`, `tools.behavior.int.test.js`) to cover:
    1. First request finishing with `tool_calls` and no placeholder narrative.
    2. Follow-up request containing `role:"tool"` content that drives a resumed assistant response.
  - Add unit/regression checks for finish_reason telemetry if necessary.

- **Telemetry & logging:**
  - Record tool cutoffs (counter + optional timing) so we can monitor them in production.
  - Verify existing finish_reason logging still works with the new shutdown path.

### Documentation & Runbooks

- Update AGENTS.md, tool-calling brief, and any relevant runbooks to:
  - Describe the expected two-step flow (initial `tool_calls` finish, follow-up `role:"tool"`).
  - Clarify that the proxy no longer synthesizes placeholder outputs.
  - Note how to replay client tool results and interpret telemetry.

### Out of Scope

- Wiring real tool execution inside the proxy.
- Changes to client-side (Obsidian/Copilot) behaviour.
- Additional tool definitions outside the existing manifest.

## Acceptance Criteria

1. **Behavioural parity:** Streaming responses end with `finish_reason:"tool_calls"` immediately after arguments are complete; non-stream responses contain the same tool data and end with `finish_reason:"tool_calls"`.
2. **Worker lifecycle:** Codex processes are terminated at cutoff and do not emit extra deltas after the HTTP response completes.
3. **Replay flow:** Follow-up requests with matching `role:"tool"` entries resume the conversation and eventually emit `finish_reason:"stop"` (or other canonical reasons).
4. **Regression tests:** Updated integration/unit tests pass without relying on placeholders; transcripts match the new contract.
5. **Docs/runbooks:** Updated to reflect the new two-step tool loop and telemetry guidance.

## Execution Plan (BMAD)

1. **Create a new story** capturing the objective, deliverables, and acceptance criteria above.
2. **PO approval** via `*story-done`, then `develop-story` under the Dev agent to implement the plan.
3. **Run full validation** (`npm run test:unit`, `npm run test:integration`, `npm run transcripts:generate`) and update the Dev Agent record.
4. **QA review** (optional) followed by story closure (`*story-done`) once all ACs are met.

## Notes

- Keep an eye on `.env.dev` flags (`PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, etc.)—they must align with the new flow to avoid cutting twice.
- Ensure no existing clients rely on placeholder content before removing it; coordinate with downstream teams if necessary.

