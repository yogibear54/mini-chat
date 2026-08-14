# Wire protocol semantics

Type: grilling
Status: resolved

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

> **Cross-ref (from [ticket 04](./04-action-pipeline-ownership.md)):** `ServerEvent.action` is **removed** (client parses `json-action` fences from the token stream). **Newly open:** does the final `message` ServerEvent carry **cleaned prose** (actions stripped by the server) for the client to persist, or does the client clean its own accumulated buffer? (Affects ticket 08.)

> **Resolved (by [ticket 08](./08-memory-policy.md)):** the **client cleans its own buffer** and persists that; the server does **not** send a cleaned `message` ServerEvent for persistence. So `message` is **redundant** for MVP — ticket 10 decides whether `message` has any remaining role (e.g. a "finalize" signal) or gets removed.

## Answer

Decisions (locked for the spec):

1. **`ChatRequest` shape — fold `message` into `history`.** The client sends the full conversation as `history` (new user message = last entry); the separate `message` field is **removed**. The server prepends the system message + windows. (No redundancy; rate-limiting is by POST, not message content.) **Also fixed:** added the missing `sessionId` field — the server needs it to route the response to the right SSE stream(s) (§3.2.2 fan-out); §5's `ChatRequest` had omitted it.
2. **System-message boundary** — client `history` is **user/assistant only**; the client **never** sends a system message (the backend assembles + injects it: system-prompt + `source.md` + action vocabulary + `pageContext`). `ChatMessage.role` keeps `"system"` but only the backend produces one.
3. **`agentId`** — kept in `ChatRequest` for forward-compat; **server-ignored no-op for MVP** (single agent). The client uses it to namespace `localStorage` (`mini-chat:{agentId}`). Routing is phase-2.
4. **`message` `ServerEvent` removed** — redundant: the server is a dumb pass-through (ticket 04), so the client's token-assembled buffer *is* the canonical message, and `done` already signals completion. `ServerEvent = token | done | error`. (`done`'s `requestId` stays for correlation.)

`PLAN.md` §5 (`ChatRequest` + `ServerEvent`) + §3.2 (POST shape) updated. Also cleaned up two stale `/api/push` references that ticket 03's propagation missed (§4 `index.ts` comment, §9 step-5 verify).

Cross-ref: [12](./12-client-ux-edge-cases.md) — error UX spans two channels: HTTP-level `429`/`503` (§3.2.1) **and** the SSE-level `error` event.

> **Cross-ref (from [ticket 07](./07-action-execution-policy-and-ux.md)):** the `Action` type **drops the `say` variant** (removed from MVP). Keep both `sectionId`/`selector` target fields — free selectors are allowed (ticket 07).
