# Client UX edge cases

Type: grilling
Status: open

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

> **Cross-ref (from [ticket 07](./07-action-execution-policy-and-ux.md)):** two UI pieces live here — the **`navigate` one-tap confirmation** ("Assistant wants to take you to <path> — Let's go / Not now") and the **action toggle** control (default ON, persisted in `prefs`).
