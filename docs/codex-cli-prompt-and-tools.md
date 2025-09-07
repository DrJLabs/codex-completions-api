<!-- Codex CLI System Prompt and Tools — source-mapped overview -->

Sources

- System prompt file: codex-rs/core/prompt.md
- Prompt assembly: codex-rs/core/src/client_common.rs (BASE_INSTRUCTIONS include + optional apply_patch instructions)
- Tool registry: codex-rs/core/src/openai_tools.rs (built-ins + MCP conversion)
- Streamable exec tools: codex-rs/core/src/exec_command/responses_api.rs
- Plan tool: codex-rs/core/src/plan_tool.rs
- User instructions merge (AGENTS.md + config): codex-rs/core/src/project_doc.rs, codex-rs/core/src/config.rs

System Prompt (Codex CLI)

- Location: codex-rs/core/prompt.md
- Role: BASE_INSTRUCTIONS injected as the “instructions” field in Requests (Responses API and Chat Completions).
- Content themes (abridged):
  - Agent identity and style (concise, direct, friendly; actionable; preambles; plans; final answer format).
  - Tooling expectations (preamble before tool calls, planning via update_plan, apply_patch usage, sandbox & approvals).
  - Output structure (headers, bullets, monospace rules, file references, tone, don’ts).

Built‑in Tools (Responses API mapping)

- shell (function): Execute commands.
  - params: `command: string[]` (required), `workdir?: string`, `timeout_ms?: number`.
  - When sandbox is WorkspaceWrite/ReadOnly: `with_escalated_permissions?: boolean`, `justification?: string`.
  - Code: openai_tools.rs:create_shell_tool / create_shell_tool_for_sandbox.

- local_shell (type: local_shell): Alt shell tool for families using “local_shell”.

- exec_command (function): Streamable shell (PTY) when experimental flag enabled.
  - params: `cmd: string` (required), `yield_time_ms?: number` (default 10000), `max_output_tokens?: number` (default 10000), `shell?: string` (default “/bin/bash”), `login?: boolean` (default true).
  - write_stdin (function): `session_id: number` (required), `chars: string` (required), `yield_time_ms?: number` (default 250), `max_output_tokens?: number` (default 10000).
  - Code: exec_command/responses_api.rs; exec_command/exec_command_params.rs.

- update_plan (function): Plan recording tool for clients.
  - params: `explanation?: string`, `plan: { step: string, status: "pending"|"in_progress"|"completed" }[]` (required); one item at most “in_progress”.
  - Code: plan_tool.rs (also emits PlanUpdate event).

- apply_patch (function or freeform): Code editing tool; included either as JSON function or “freeform” depending on model family and config.
  - Freeform instructions: codex-rs/apply-patch/apply_patch_tool_instructions.md auto‑appended if needed.

- web_search (type: web_search): OpenAI Responses API web search tool (enabled by config flag).
  - Exposed when `tools.web_search=true` (config).

- view_image (function): Attach local image to context.
  - params: `path: string` (required).

- MCP tools: All configured MCP servers’ tools are converted into Responses‑API function tools via JSON‑Schema sanitization.

How Codex assembles the request

- Instructions:
  - `BASE_INSTRUCTIONS` = codex-rs/core/prompt.md.
  - Optionally augmented with apply_patch instructions when the model/tool combo needs it.
  - Can be overridden via config `base_instructions` or `experimental_instructions_file`.
- User instructions (separate from “instructions”):
  - Optional `config.instructions` and all discovered AGENTS.md files (from repo root → cwd), concatenated (project_doc.rs), subject to `project_doc_max_bytes`.
  - These become a dedicated “user_instructions” item in the conversation (rendered as a tagged block), not the model “instructions”.
- Tools: built‑ins + MCP tools from configured servers (sorted for cache‑friendliness).
- Input: whatever the client sends as ResponseItem list.

Interplay with “Obsidian Copilot” prompt

- Copilot’s system prompt (from the client) currently arrives as plain user text in our proxy’s joined message string.
  - In Codex CLI, that lands under input (and possibly as a user_instructions block if present), whereas Codex’s BASE_INSTRUCTIONS remain the model‑level “instructions”.
  - Net effect: Codex rules (prompt.md) are authoritative; Copilot prompt is treated as context/constraints unless we explicitly elevate it.

Proxy‑level methods to improve alignment—without rewriting either side’s prompts

1. Elevate Copilot guidance to Codex “user_instructions”.
   - Approach A (config‑only): write the Copilot system prompt into `CODEX_HOME/AGENTS.md` for the dev session and raise `project_doc_max_bytes` (>0). Codex will concatenate it as user_instructions automatically.
   - Approach B (runtime override): add a one‑time “OverrideTurnContext” submission before the first turn setting `user_instructions=<copilot prompt>`. (Requires proxy to speak Codex protocol; optional follow‑up.)

2. Preserve Copilot tool semantics by enabling Codex web search only when needed.
   - Detect `<name>webSearch</name>` (or `name="webSearch"`) in incoming prompts; set `tools.web_search=true` for that request via `--config tools.web_search=true`. Keep it off by default to avoid unwanted crawls.

3. Improve research depth/quality via structured web results and caching.
   - Wrap Codex Responses “web_search” tool at proxy: aggregate results to n-high‑quality citations (title, URL, snippet, access date), de‑duplicate domains, and feed compact summaries back to the model as follow‑up input chunks. Maintain a per‑session cache keyed by query.
   - Keep Codex’s `parallel_tool_calls=false` (default) for determinism; proxy can still serialize multiple searches.

4. Strengthen answer checking without prompt edits.
   - Post‑turn validation hooks at the proxy (dev only):
     - Heuristic checker for “source‑free claims” → prompt a follow‑up “please cite” turn.
     - Token budget guardrails: if `token_count.total_tokens` is high and citations are low, force an additional “source dive” turn.

5. Apply‑patch safety and clarity.
   - Ensure apply_patch tool is present (or its freeform instructions auto‑appended). For non‑function variants, the proxy can enforce minimal diff hygiene (file path allowance, size limits) and reject suspicious patches with a helpful message.

6. Align verbosity and reasoning.
   - Codex supports `reasoning.effort` and GPT‑5 `text.verbosity`. If the client signals “deep research” in its prompt, have the proxy set `--config model_reasoning_effort=high` and (for gpt‑5 family) raise verbosity to `high` on that turn only.

Practical wiring in this repo (proxy)

- Elevate Copilot prompt:
  - For your dev stack, write the captured Copilot system prompt to `.codev/AGENTS.md` (already bind‑mounted as Codex HOME) and change `project_doc_max_bytes` from 0 → e.g., 65536 for dev runs.
  - Alternatively, pass `--config experimental_instructions_file=/app/.codex/AGENTS.md` to force an override of BASE_INSTRUCTIONS (only if you explicitly want Codex system instructions replaced). Prefer user_instructions approach first.
- Conditional web search:
  - Inspect incoming prompt; if it contains `<name>webSearch</name>` or `name="webSearch"`, append `--config tools.web_search=true` for that request; else leave false.
- Research loop helper (optional):
  - After a streaming turn with thin citations, auto‑enqueue a “cite sources” follow‑up user message to nudge consolidation, keeping prompts unchanged.

Tool Parameters — quick reference

- shell: `{ command: string[]; workdir?: string; timeout_ms?: number; (with_escalated_permissions?: boolean; justification?: string) }`
- exec_command: `{ cmd: string; yield_time_ms?: number; max_output_tokens?: number; shell?: string; login?: boolean }`
- write_stdin: `{ session_id: number; chars: string; yield_time_ms?: number; max_output_tokens?: number }`
- update_plan: `{ explanation?: string; plan: { step: string; status: "pending"|"in_progress"|"completed" }[] }`
- apply_patch (function or freeform): see built‑in instructions auto‑attached when needed.
- web_search: type: "web_search" (Responses API builtin; no params here).
- view_image: `{ path: string }`
