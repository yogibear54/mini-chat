# Mini-Chat — Wayfinder Map

## Destination

A **decision-complete, buildable spec** for Mini-Chat: take `PLAN.md` (locked
architecture) and resolve every open design decision within its §7 MVP scope so
a coding agent can implement it with zero silent assumptions. The map produces
**decisions, not code**.

## Notes

- **Domain:** a drop-in `<script>` chat-agent widget (Shadow-DOM, React bundled)
  plus a Node/TS backend proxy with an extensible OpenAI-compatible provider.
  `PLAN.md` holds the locked architecture and §7 scope — read it first.
- **Destination type:** buildable spec (wayfinder "plan, don't do").
- **Audience:** a coding agent (pi) — so every decision must be exhaustive and
  explicit; no silent assumptions survive into the spec.
- **Scope is locked** to `PLAN.md` §7 (incl. expressive orb/movement,
  localStorage memory, the 5 actions). Do not expand.
- **Skills each session should consult:** `/grilling` + `/domain-modeling` for
  decision tickets; `/prototype` for the orb-engine ticket; `/research` already
  fired (see Decisions so far).
- **Tracker:** local-markdown. Tickets in `.scratch/mini-chat/issues/`; this map
  is the index (open tickets are found by scanning `issues/`, not listed here).
- `PLAN.md` is the skeleton; tickets fill its gaps. On resolution, update the
  relevant `PLAN.md` section (or record the delta) as part of the answer.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [SSE & streaming facts](issues/01-sse-and-streaming-facts.md) — EventSource is GET-only (no headers/body): auth must be a query param/cookie; CORS allowlist is the only native transport gate; auto-reconnect is free, Last-Event-ID replay needs server buffering; keepalive pings needed; upstream format is `data:{…}` chunks + `data: [DONE]`.
- [Client markdown sanitization options](issues/02-client-markdown-sanitization.md) — react-markdown is safe-by-default (no raw HTML unless rehype-raw); recommended react-markdown + rehype-sanitize; marked+DOMPurify is the lighter alternative; Shadow DOM doesn't replace sanitization.
- [Backend trust & abuse model](issues/03-backend-trust-and-abuse-model.md) — greeting is client-rendered static (no LLM); `/api/push` removed from MVP (reactive autonomy); abuse gate = Origin allowlist + per-IP rate limit (30/min) + daily budget cap ($5), site token off; `sessionId` = client UUIDv4 trusted as-is (cookie-binding deferred to phase 2).
- [Action pipeline ownership](issues/04-action-pipeline-ownership.md) — **client parses**; server is a dumb token pass-through; `json-action` fences (info string exactly `json-action`, case-sensitive) parsed client-side, suppressed from render, one `Action` per block in document order, fire on block-complete; only `json-action` fences execute; malformed → discard+log; `ServerEvent.action` removed.
- [SSE lifecycle](issues/05-sse-lifecycle.md) — client UUID `sessionId` (rotated on clear); native auto-reconnect, **no buffering / `Last-Event-ID` replay** (memoryless; mid-answer drop loses the turn → retry affordance); server aborts upstream on last-stream-close; keepalive 15 s ping / 35 s watchdog redial; **multi-tab fan-out** (`sessionId → Set<streams>`, all tabs stream — last-wins rejected for watchdog ping-pong); navigation gap accepted (no queue).
- [Markdown render safety & scope](issues/06-markdown-render-safety-and-scope.md) — `react-markdown` + `rehype-sanitize` (no `rehype-raw`); `remark-gfm` allowlist (tables in, **images blocked**, **no syntax highlighting**); links open new-tab + `noopener noreferrer`, schemes http/https/mailto/tel only; action **scanner pre-strips** `json-action` fences so the renderer only sees cleaned prose.
- [Action execution policy & UX](issues/07-action-execution-policy-and-ux.md) — **free selectors** (must match exactly one host element, not in widget shadow DOM / not script|style|head|…); rate cap 8 actions/5 s (drop+log); invalid → silent ignore + log; **`navigate` needs one-tap confirmation** (others immediate); scrollTo smooth-center, highlight ~2 s auto-fade, move adjacent-not-overlapping + viewport-clamped; action toggle in panel (persisted, default ON, OFF = no-op); **`say` dropped from MVP**.

## Not yet specified

<!-- fog toward the destination — in scope, not yet sharp enough to ticket -->

- **Backend deployment & hosting.** Where the proxy runs and how the LLM API key
  is provisioned/env-managed. Likely a `task` ticket once a target is chosen;
  can't specify sharply yet (and interacts with the backend trust decision,
  ticket 03).
- **Knowledge authoring & the wholesale-injection ceiling.** How the operator
  writes/updates `knowledge/source.md`, and how large it can grow before
  wholesale injection blows the context window. RAG/chunking itself is out of
  scope, but "when does wholesale fail?" is a real future question.
- **Provider tool-calling adoption.** Actions are text-based (`json-action`) to
  stay provider-agnostic; when/how to move to native tool-calling per provider
  is a later optimization — not yet sharp.

## Out of scope

<!-- ruled beyond this destination -->

- RAG / chunking over the knowledge base (phase 2).
- Backend-side persistence / cross-device & cross-origin memory (phase 2;
  localStorage is per-origin).
- Auth, multi-user accounts.
- Multi-agent routing by `agentId` (field kept in the protocol, no-op for MVP).
- Tool/function-calling optimization; backend message queue for navigation gaps.
- Proactive observer / unprompted initiation beyond the on-open greeting.
- Free-roaming wander / fully rigged mascot character.
- **Pure-aesthetic parameters** (idle-bob amplitude, glide easing curve,
  highlight color, exact `data-*` attribute names) — left to the implementer's
  discretion, not ticketed as decisions.
