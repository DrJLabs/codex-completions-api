---
title: "Slice Review Template – codex-completions-api"
status: "draft"
version: "1.0.0"
created: 2025-12-07
tags:
  - review
  - qa
  - codex-completions-api
---

# Slice Review – {{TASK_ID}} – {{SHORT_NAME}}

> Use this template for each focused analysis task (topology, flows, translation layer, etc.).
> Replace `{{…}}` placeholders and remove guidance comments as you fill it out.

## 1. Scope

- **Task ID:** {{TASK_ID}} (e.g., `Task 01`)
- **Short name:** {{SHORT_NAME}} (e.g., `Repository Topology & Runtime Surfaces`)
- **Date:** {{DATE}}
- **Reviewer / Agent:** {{REVIEWER_NAME_OR_AGENT}}
- **Branch / Ref:** {{BRANCH_OR_COMMIT}} (e.g., `main @ <sha>`)

**In-scope paths**

- `{{PATH_1}}`
- `{{PATH_2}}`
- …

**Out-of-scope for this slice**

- `{{PATH_OR_AREA}}` (e.g., “Tool-calling adapters”)
- `{{PATH_OR_AREA}}`

---

## 2. Component Inventory

> List the components in scope for this slice. Keep the table to “meaningful units”: files, modules, or logical subsystems.

| Component | Path / Identifier              | Type       | Role                                           | Status             | Risks / Smells                          | Notes |
|----------|---------------------------------|-----------|------------------------------------------------|--------------------|-----------------------------------------|-------|
|          |                                 |           |                                                | current / legacy   |                                         |       |
| Example  | `server.js`                    | entrypoint| Main process bootstrap, backend selection      | current            | Ties CLI flags + envs directly to app   |       |
| Example  | `auth/server.mjs`             | service   | Traefik ForwardAuth handler                    | current            | Auth surface depends on bearer parity   |       |

---

## 3. Top Issues (Slice-Level)

> 3–10 bullets, ordered by impact. Focus only on issues visible within this slice.

1. **[ISSUE-{{TASK_ID}}-01]** Short title (e.g., “Duplicate ForwardAuth entrypoints under `auth/` cause drift risk.”)  
   - Detail: …
2. **[ISSUE-{{TASK_ID}}-02]** …
3. **[ISSUE-{{TASK_ID}}-03]** …

---

## 4. Suggested Changes (Slice-Level)

> Concrete actions tied to issues above. These are **slice-local** and may later be regrouped into global epics.

- **SC-{{TASK_ID}}-001 – Short title of suggested change**  
  - Related issues: ISSUE-{{TASK_ID}}-01, ISSUE-{{TASK_ID}}-03  
  - Impact: High / Medium / Low  
  - Effort: S / M / L  
  - Description:  
    - What should change?  
    - Where (files/modules)?  
    - Any important constraints/assumptions?

- **SC-{{TASK_ID}}-002 – …**  
  - Related issues: …
  - Impact: …
  - Effort: …
  - Description: …

---

## 5. Open Questions / Dependencies

> Things that block or influence remediation work.

- **OQ-{{TASK_ID}}-01 – Question title**  
  - Detail:  
  - Dependency on: (another slice, external system, decision, etc.)

- **OQ-{{TASK_ID}}-02 – …**

---

## 6. Notes for Global Synthesis

> Optional. Use this to annotate cross-cutting themes you notice while doing this slice.

- Theme: {{e.g., “Multiple deployment modalities with no single source-of-truth for config.”}}
- Theme: {{…}}
