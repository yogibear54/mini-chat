# Backend trust & abuse model

Type: grilling
Status: open

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
