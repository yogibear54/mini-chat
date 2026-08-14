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
- **Status: COMPLETE** — all 12 tickets resolved; the frontier is empty. Former
  fog items were all future-phase questions and now live in Out of scope.
  `PLAN.md` is the decision-complete spec; §9 is the build plan — hand off to
  implementation.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [SSE & streaming facts](issues/01-sse-and-streaming-facts.md) — EventSource is GET-only (no headers/body): auth must be a query param/cookie; CORS allowlist is the only native transport gate; auto-reconnect is free, Last-Event-ID replay needs server buffering; keepalive pings needed; upstream format is `data:{…}` chunks + `data: [DONE]`.
- [Client markdown sanitization options](issues/02-client-markdown-sanitization.md) — react-markdown is safe-by-default (no raw HTML unless rehype-raw); recommended react-markdown + rehype-sanitize; marked+DOMPurify is the lighter alternative; Shadow DOM doesn't replace sanitization.
- [Backend trust & abuse model](issues/03-backend-trust-and-abuse-model.md) — greeting is client-rendered static (no LLM); `/api/push` removed from MVP (reactive autonomy); abuse gate = Origin allowlist + per-IP rate limit (30/min) + daily budget cap ($5), site token off; `sessionId` = client UUIDv4 trusted as-is (cookie-binding deferred to phase 2).
- [Action pipeline ownership](issues/04-action-pipeline-ownership.md) — **client parses**; server is a dumb token pass-through; `json-action` fences (info string exactly `json-action`, case-sensitive) parsed client-side, suppressed from render, one `Action` per block in document order, fire on block-complete; only `json-action` fences execute; malformed → discard+log; `ServerEvent.action` removed.
- [SSE lifecycle](issues/05-sse-lifecycle.md) — client UUID `sessionId` (rotated on clear); native auto-reconnect, **no buffering / `Last-Event-ID` replay** (memoryless; mid-answer drop loses the turn → retry affordance); server aborts upstream on last-stream-close; keepalive 15 s ping / 35 s watchdog redial; **multi-tab fan-out** (`sessionId → Set<streams>`, all tabs stream — last-wins rejected for watchdog ping-pong); navigation gap accepted (no queue).
- [Markdown render safety & scope](issues/06-markdown-render-safety-and-scope.md) — `react-markdown` + `rehype-sanitize` (no `rehype-raw`); `remark-gfm` allowlist (tables in, **images blocked**, **no syntax highlighting**); links open new-tab + `noopener noreferrer`, schemes http/https/mailto/tel only; action **scanner pre-strips** `json-action` fences so the renderer only sees cleaned prose.
- [Action execution policy & UX](issues/07-action-execution-policy-and-ux.md) — **free selectors** (must match exactly one host element, not in widget shadow DOM / not script|style|head|…); rate cap 8 actions/5 s (drop+log); invalid → silent ignore + log; **`navigate` needs one-tap confirmation** (others immediate); scrollTo smooth-center, highlight ~2 s auto-fade, move adjacent-not-overlapping + viewport-clamped; action toggle in panel (persisted, default ON, OFF = no-op); **`say` dropped from MVP**.
- [Memory policy](issues/08-memory-policy.md) — rolling cap **both** ≤100 msgs & ≤100 KB (oldest-first; system msg not stored); `prefs` = `{ actionsEnabled, position? }` only (accent/title from config, open-state not saved); multi-tab **last-write-wins**; persist **client-cleaned prose** (no server `message` needed → resolves ticket 10); validate-on-load reset + try/catch in-memory fallback; "Clear chat" wipes history + rotates sessionId, `prefs` survive.
- [Perception rules](issues/09-perception-rules.md) — selectors h1–h3/section[id]/[data-mini-section]; label = aria-label→data-mini-label→heading→id (~80 char); ids = existing or `mini-s-<slug>` (namespaced, only-added); current-section = `IntersectionObserver` middle band, topmost wins, 150 ms debounce; section-change **client-local** (rides next message); re-scan on load **+ SPA route changes** (Option C: popstate/hashchange/pushState-hook, id-stable via WeakMap) — full `MutationObserver` content-watcher deferred.
- [Wire protocol semantics](issues/10-wire-protocol-semantics.md) — `ChatRequest` folds `message` into `history` (full conversation, new user msg as last entry; **added the missing `sessionId`** for stream routing); client sends user/assistant only (never system — backend injects); `agentId` = server-ignored no-op for MVP; `message` `ServerEvent` **removed** (redundant) → `token | done | error`.
- [Orb expression & movement engine](issues/11-orb-expression-and-movement-engine.md) — **4-state lifecycle** (idle/thinking/speaking/done) + **gaze as a separate axis** (eyes track target any state); `speaking` mouth animates; glide on outer transform, idle bob on inner; **viewport clamped** to 14 px; **user-draggable** w/ 4 px drag-vs-click threshold (drag updates `home`); `move` action is temporary → orb **returns home** after `done`; mobile re-clamps. (Prototype: `prototypes/orb.html`.)
- [Client UX edge cases](issues/12-client-ux-edge-cases.md) — inline friendly **error UX** (429 "slow down" no-retry; 503 budget-cap disables input — the only case; unreachable & mid-stream errors get **Retry**; invalid actions silent); transient "reconnecting…" + dropped-turn retry (ticket 05); **Stop button deferred** (no `/api/cancel` in MVP); a11y bar = button semantics + focus management + polite live region + reduced-motion + keyboard; config precedence **init() → MiniChatConfig → data-* → defaults** (per-setting).

## Not yet specified

<!-- fog toward the destination — in scope, not yet sharp enough to ticket -->

*None — the frontier is empty and the way to the destination is clear. The
former fog items below all turned out to be future-phase questions, not
MVP-spec decisions, and moved to Out of scope.*

## Out of scope

<!-- ruled beyond this destination -->

- RAG / chunking over the knowledge base (phase 2).
- Backend-side persistence / cross-device & cross-origin memory (phase 2;
  localStorage is per-origin).
- Auth, multi-user accounts.
- Multi-agent routing by `agentId` (field kept in the protocol, no-op for MVP).
- Tool/function-calling optimization; backend message queue for navigation gaps.
- Backend deployment/hosting choice + multi-instance state (Redis) — ops
  questions beyond the spec; §9 step 13 covers run instructions.
- Knowledge-authoring workflow + the wholesale-injection ceiling — phase 2
  (with RAG/chunking).
- SPA fine-grained content-watcher (`MutationObserver` within-route) — deferred
  from [ticket 09](issues/09-perception-rules.md), phase 2.
- Stop/cancel button + `/api/cancel` endpoint — deferred from
  [ticket 12](issues/12-client-ux-edge-cases.md), phase 2.
- Proactive observer / unprompted initiation beyond the on-open greeting.
- Free-roaming wander / fully rigged mascot character.
- **Pure-aesthetic parameters** (idle-bob amplitude, glide easing curve,
  highlight color, exact `data-*` attribute names) — left to the implementer's
  discretion, not ticketed as decisions.
