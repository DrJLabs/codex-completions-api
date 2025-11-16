# Engineering Backlog

This backlog collects cross-cutting or future action items that emerge from reviews and planning.

Routing guidance:

- Use this file for non-urgent optimizations, refactors, or follow-ups that span multiple stories/epics.
- Must-fix items to ship a story belong in that story’s `Tasks / Subtasks`.
- Same-epic improvements may also be captured under the epic Tech Spec `Post-Review Follow-ups` section.

| Date       | Story | Epic | Type        | Severity | Owner | Status | Notes                                                                                                           |
| ---------- | ----- | ---- | ----------- | -------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------- |
| 2025-10-31 | 1-6   | 1    | Doc tooling | High     | TBD   | Done   | Updated `lint:runbooks` to lint docs/app-server-migration and confirmed command success (2025-10-31T19:21:35Z). |
| 2025-11-16 | 2-11  | 2    | Bug         | High     | TBD   | Open   | Move `logHttpRequest` earlier in all chat/completions handlers so HTTP ingress traces are captured even when validation returns 4xx. |
| 2025-11-16 | 2-11  | 2    | Bug         | High     | TBD   | Open   | Emit `appendUsage` entries (req_id/route/method/mode/status_code) for every exit path so `/v1/usage/raw` stays joinable with HTTP ingress traces. |
| 2025-11-16 | 2-11  | 2    | Bug         | Medium   | TBD   | Open   | Ensure `logHttpRequest` executes immediately after JSON parsing even for unauthorized requests so 401s still produce `phase:"http_ingress"` events. |
