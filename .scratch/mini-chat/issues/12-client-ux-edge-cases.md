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
