# SSE lifecycle

Type: grilling
Status: open
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
