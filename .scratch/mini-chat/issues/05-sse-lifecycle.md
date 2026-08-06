# SSE lifecycle

Type: grilling
Status: resolved
Blocked by: 01

## Question

Pin down the client + server SSE lifecycle using the facts from
[ticket 01](./01-sse-and-streaming-facts.md). Decide:

- **`sessionId`** — generated where (client UUID), when (before first connect),
  stored in localStorage (yes), rotated on "Clear chat" (yes).
- **Reconnect strategy** — rely on EventSource auto-reconnect? Use `Last-Event-ID`
  for resumability (does the server buffer anything to resume)? Backoff on
  repeated failure?
- **Keepalive** — server comment-line ping interval; client timeout to declare
  the stream dead and force a reconnect.
- **Multi-tab** — which tab owns the live stream (last-connected-wins per the
  `sessions` map); what the other tabs experience; how a tab rejoins as the
  active one. (Coordinate with ticket 08 on multi-tab *write* conflicts.)
- **Navigation gap** — what (if anything) is lost across a full page navigation,
  and confirm MVP accepts that loss (backend queue is out of scope).

PLAN refs: §3.2, §3.6.

> **Cross-ref (from [ticket 03](./03-backend-trust-and-abuse-model.md)):** `/api/push` is removed from MVP — the SSE channel carries only streamed tokens for `/api/chat` responses (no server-initiated messages). The greeting is client-rendered, not pushed.

## Answer

Decisions (locked for the spec):

1. **`sessionId` lifecycle** — client-generated `crypto.randomUUID()` before first connect; stored in `localStorage` (`mini-chat:{agentId}`); **rotated to a fresh UUID on "Clear chat."** Server is stateless on history.
2. **Reconnect — no buffering/replay.** Rely on native EventSource auto-reconnect (~3 s). **No server-side buffer, no `Last-Event-ID` replay** (memoryless server). A drop **mid-answer loses that answer**; client shows a **retry affordance** (no silent auto-resend — avoids double-spend; UX in ticket 12). When a stream closes mid-turn, the server **aborts the upstream LLM fetch** (no wasted spend).
3. **Keepalive** — server comment-line ping (`: ping`) every **15 s**; client watchdog redials (`close()` + new `EventSource`) after **35 s** of silence (>2× ping — tolerates one missed ping, catches silent death from middlemen that native reconnect can't).
4. **Multi-tab — fan-out (option b), not last-wins.** Server keeps `sessionId → Set<streams>` and streams each reply to **every** open tab. Last-wins was rejected: a quiet tab's watchdog would redial and steal the live stream, ping-ponging the "mic" between tabs indefinitely. Fan-out removes the orphaned-tab problem. (Concurrent message-typing across tabs is a *write* conflict → ticket 08.)
5. **Navigation gap — accept the loss.** Full nav drops the SSE; the new page rehydrates the same `sessionId` + history from `localStorage` and reconnects (conversation survives). Words lost if the user navigates exactly mid-reply. **No server-side queue** (consistent with the memoryless design and ticket 03).

Server-state change: `sessions` is now `sessionId → Set<streams>` (was a single stream). "Abort upstream" fires when the **last** stream for a session closes.

Cross-refs: [08](./08-memory-policy.md) (multi-tab now write-conflict-only), [12](./12-client-ux-edge-cases.md) (retry affordance + dropped-turn UX). `PLAN.md` §3.2 (+ new §3.2.2), §3.6, §11 updated; corrected prior "most-recently-connected tab / one tab owns" wording.
