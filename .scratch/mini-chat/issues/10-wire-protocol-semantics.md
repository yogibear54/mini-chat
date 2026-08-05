# Wire protocol semantics

Type: grilling
Status: open

## Question

Tighten `shared/types.ts` (`PLAN.md` §5) semantics. Sub-questions:

- **`ChatRequest` shape.** Is `message` separate from `history` (server appends
  it), or must the client already include it as `history`'s last user message?
  Remove the redundancy one way or the other.
- **System-message boundary.** Client `history` excludes the system message
  (backend injects) — confirm and document; does the client ever send a system
  message?
- **`agentId`.** Single-agent config for MVP (routing is out of scope). Keep the
  field but document it as a no-op.
- **`ServerEvent` `action` type.** Resolve against ticket 04 — keep it, remove
  it, or repurpose, depending on who parses actions.

PLAN ref: §5.

> **Cross-ref (from [ticket 03](./03-backend-trust-and-abuse-model.md)):** `/api/push` is removed, so the `ServerEvent` `message` type's "server-initiated" use-case is gone — only *complete* assistant messages remain, and there is no push endpoint. The `429` (rate-limited) / `503` (budget-exceeded) abuse-protection responses also need representing in the client error model.
