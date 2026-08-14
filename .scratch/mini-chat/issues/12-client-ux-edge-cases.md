# Client UX edge cases

Type: grilling
Status: resolved

## Question

Decide the non-happy-path client UX. Sub-questions:

- **Error UX.** Backend unreachable, provider error, invalid action — what does
  the user see?
- **Cancel / abort.** Can the user stop a streaming generation? (`PLAN.md`
  doesn't mention abort.) If yes, the wire-protocol / `AbortController`
  implications.
- **Accessibility baseline.** Orb button ARIA label/role; panel open focus
  management; keyboard send; `prefers-reduced-motion` respect for the orb/bob.
- **Config precedence.** `window.MiniChatConfig` vs `MiniChat.init(...)` vs
  `data-*` attributes — which wins when they conflict?

PLAN refs: §3.1, §6.

> **Cross-ref (from [ticket 03](./03-backend-trust-and-abuse-model.md)):** error UX must cover the abuse-protection states: `429` (per-IP rate limited) and `503` (daily budget cap exceeded / backend disabled).

> **Cross-ref (from [ticket 05](./05-sse-lifecycle.md)):** add a **retry affordance** for a dropped mid-stream turn (no silent auto-resend — avoids double-spend), and a transient "reconnecting…" state when the watchdog redials.

> **Cross-ref (from [ticket 10](./10-wire-protocol-semantics.md)):** error UX spans two channels — HTTP-level `429`/`503` (§3.2.1, from ticket 03) **and** the SSE-level `error` event (backend/provider failure mid-stream). Handle both.

> **Cross-ref (from [ticket 07](./07-action-execution-policy-and-ux.md)):** two UI pieces live here — the **`navigate` one-tap confirmation** ("Assistant wants to take you to <path> — Let's go / Not now") and the **action toggle** control (default ON, persisted in `prefs`).

## Answer

Decisions (locked for the spec):

1. **Error UX — inline, friendly, differentiated** (never popups; orb stays neutral): `429` rate-limit → "Slow down a sec — try again in a moment." (no retry; input stays enabled); `503` budget cap → "The assistant is taking a break for today." (**the only case that disables the input**); backend unreachable → "Can't reach the assistant — check your connection." + **Retry**; mid-stream SSE `error` → keep partial text + "Something went wrong finishing that." + **Retry** (re-sends last message). Invalid actions stay silent (ticket 07). Watchdog reconnect shows a transient "reconnecting…"; a lost in-flight turn gets the retry affordance (ticket 05).
2. **Stop/cancel — DEFERRED (option b).** No Stop button and no `/api/cancel` endpoint in MVP; replies run to completion. (Closing the tab/page still aborts upstream spend — §3.2.2 — so the budget isn't silently burned.) Logged in the map's Out of scope for phase 2.
3. **Accessibility — all five:** orb is a real `<button>` (accessible name = configured title; Enter/Space opens); focus → input on open, → orb on close; message list = polite `aria-live`; `prefers-reduced-motion` skips glide + bob (teleport); Enter sends / Esc closes / natural Tab order.
4. **Config precedence (option a):** `MiniChat.init({...})` → `window.MiniChatConfig` → `data-*` → built-in defaults, **per-setting** (each level overrides only the levels below it).

`PLAN.md` new §3.8; §6 precedence; §7 in-scope (error UX + a11y) and out-of-scope (Stop deferred) updated.
