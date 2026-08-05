# Backend trust & abuse model

Type: grilling
Status: resolved

## Question

Define the authorization and abuse-protection model for the MVP backend so a
publicly-reachable `/api/chat` (which spends real LLM tokens) and `/api/push`
can't be cheaply abused. `PLAN.md` gates these only by an Origin allowlist,
which is spoofable outside a browser.

Sub-questions:

- **Abuse gate beyond Origin.** Per-session / per-IP rate limiting? a shared
  site secret embedded in the served `<script>`? a spend/budget cap? a `Referer`
  check? Pick the MVP set and state the residual risk.
- **`/api/push` authorization.** Who may call it — server-internal only, or
  gated by a secret? If public, anyone can inject a `say` message into any
  `sessionId`'s stream. Decide the gate.
- **Greeting mechanism (reconcile the inconsistency).** `PLAN.md` §3.6 says the
  greeting "fires only when stored history is empty" (sounds client-initiated),
  but the push endpoint implies server-initiated. Decide: is the greeting a
  normal client→server chat turn, or a server→client push — and make the push
  endpoint's role consistent with that.
- **`sessionId` trust.** Client-generated UUIDs blindly key the server's
  `sessions` map. State the threat model and whether MVP accepts this as-is or
  binds it somehow.

These are decisions (user-owned); the answers become the backend's
auth/abuse section of the spec. PLAN refs: §3.2, §3.6, §6.

## Answer

Decisions (locked for the spec):

1. **Greeting = client-rendered static.** On first open with empty history, the widget shows `GREETING_TEXT` locally as the first assistant message. No LLM call, no latency, no token cost.
2. **`/api/push` removed from MVP.** Reactive autonomy (§2) means the server never initiates; the push channel had no MVP job. This dissolves the push-authorization sub-question entirely. (Server-initiated push is a deliberate phase-2 capability, with real auth.)
3. **Abuse gate on `/api/chat`** = Origin allowlist + per-IP rate limit (30 msgs/min/IP, in-memory, configurable) + daily budget cap ($5/day, configurable); **site token OFF**. Rate limit counts chat *turns* (POSTs), not tokens; exceeded → `429`. Budget exceeded → `503` (disabled, resets daily). Measure spend from provider usage (`stream_options.include_usage`) when available, else estimate.
4. **`sessionId` trust = accept client-generated UUIDv4 as-is for MVP.** Residual: a same-origin script reading `localStorage` can impersonate (pre-existing XSS caveat, §3.6); the daily cap is the backstop. Server-issued `httpOnly` cookie binding deferred to phase 2.

Caveats: in-memory rate-limit state is single-instance (multi-instance needs Redis — deployment fog); per-IP has CGNAT/IPv6 caveats.

Cross-refs (updated): simplifies [ticket 05](./05-sse-lifecycle.md) (no push), [ticket 10](./10-wire-protocol-semantics.md) (no server-initiated `message`, no `/api/push`), [ticket 12](./12-client-ux-edge-cases.md) (429/503 error states). `PLAN.md` §2/§3.2/§6/§7 updated.
