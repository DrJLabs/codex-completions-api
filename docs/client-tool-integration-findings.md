# Client Tool Integration — Findings and Proxy Plan

Context: Obsidian Copilot (client) sends a system prompt with <use_tool> semantics. Our proxy fronts Codex CLI (which uses its own BASE_INSTRUCTIONS and tool registry). We analyzed two adjacent turns: one succeeded (webSearch + file edits executed), one failed (ended after a planning line with embedded tool blocks).

## Summary (What happened)

- Successful turn:
  - Assistant output contained <use_tool> blocks.
  - Client executed tools and emitted lines like `Tool 'webSearch' result: …`, followed by file edits (`writeToFile`, `replaceInFile`).
- Failing turn (req_id: fgazt4qisbt3cdV2A3I0W):
  - Assistant streamed narrative first (planning), then 7 <use_tool> blocks (all webSearch).
  - Our dev parser recorded 7 `tool_block` entries with valid `name=query` pairs.
  - No client tool execution followed (no `Tool '…' result` lines). Stream closed with `token_count` → `task_complete`.
- No proxy/Codex config changed between the two turns (Codex `web_search` remained disabled; client tools are responsible for search and edits).

## Root cause (most likely)

- The client tool-runner did not trigger for the failing message despite valid <use_tool> blocks. This is consistent with a parser precondition on message shape (e.g., tool block must be the first content in the assistant message or one block per message). Minor differences in narrative before the first tool block and/or multi-block bursts likely tripped the client parser.
- Server-side rails were off: Codex `web_search` is disabled and `apply_patch` is not guaranteed present for fallback edits if the client parser misses.

## Evidence (logs)

- Failing turn:
  - NDJSON shows `tool_block` idx=1..7 (webSearch queries) with timestamps, proving tool blocks emitted.
  - No subsequent `Tool '…' result` lines in app logs.
  - Assistant final message is just tool blocks and then stream completion.
- Successful turn (previous):
  - App logs contain many `Tool 'webSearch' result` lines interleaved with later `writeToFile`/`replaceInFile` results.

## Parallel vs. serialized tool execution

- From available logs, tool execution appears serialized:
  - We see a sequential stream of `Tool 'webSearch' result` entries; no interleaved “start/finish” markers across distinct tools.
  - NDJSON `tool_block` timestamps reflect assistant emission time (not execution) and are clustered, but the client-side run results arrive in ordered bursts.
- Conclusion: No evidence of true parallel execution; behavior is consistent with sequential tool runs. (Definitive proof would require client to emit toolStart/toolEnd with IDs/timestamps.)

## Interplay of prompts (Codex vs. Copilot)

- Codex CLI uses BASE_INSTRUCTIONS (codex-rs/core/prompt.md) as model “instructions” and treats AGENTS.md + config text as `user_instructions` context.
- Copilot’s system prompt arrives as ordinary input text unless elevated. Therefore, Codex’s output formatting/narrative may precede tool blocks unless nudged.

## Targeted fixes (no prompt rewrites)

1. Tool‑first message reshaping (proxy)
   - When an assistant message contains one or more <use_tool> blocks and any narrative:
     - Split into tool‑only chunks (one block per assistant message), then narrative in a final chunk.
   - Rationale: maximizes compatibility with clients that require tool blocks to be first and/or alone.

2. Multi‑block burst sharding (proxy)
   - Serialize multiple tool blocks into separate assistant chunks even if the model emitted them together.

3. “No‑result” guard (proxy; dev first)
   - After emitting a tool‑only chunk, wait N seconds for a client submission containing `Tool '…' result`. If nothing arrives, log a warning and optionally re‑emit the first tool block unadorned.

4. Server‑side rails for robustness (optional)
   - Include `apply_patch` tool by default so server-side edits succeed if client tools don’t run.
   - Conditionally enable Codex `web_search` only when assistant just emitted `webSearch` tool blocks—keeps default off, but provides fallback.

5. Observability
   - Keep structured `tool_block` NDJSON events. Add `split_emitted: true` annotations when reshaping, and a short wait/timeout metric for client results.
   - If possible, extend client to emit toolStart/toolEnd markers with timestamps.

## Plan (phased)

Phase 1 — Dev-only guardrails

- Add PROXY_TOOL_BLOCK_SPLIT=true (default in dev) to split tool blocks out of mixed messages and emit them first.
- Add a 3–5s client-result guard: warn if no `Tool '…' result` detected; (optionally) re-emit the first tool block.
- Unit experiment: replay a failing message; confirm client runs tools.

Phase 2 — Resilience

- Ensure `apply_patch` is available to the model (function or freeform). Keep Codex `web_search` off by default; enable per-turn when assistant emitted `webSearch`.
- Add NDJSON annotations for splits and guard triggers.

Phase 3 — (Optional) Client parser hardening

- If client is modifiable: accept tool blocks anywhere in the first assistant message; tolerate narrative before/after; support multiple blocks per message.

## Acceptance checks

- Reproduce the failing pattern (narrative + multi-block) — client executes tools and logs `Tool '…' result` lines.
- Verify file edits appear (`writeToFile`/`replaceInFile`) in app logs.
- Confirm no accidental double-execution with the re-emit guard disabled.
