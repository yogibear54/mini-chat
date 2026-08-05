# Action pipeline ownership

Type: grilling
Status: open

## Question

Resolve the contradiction in `PLAN.md` between **§3.4** (the *client* scans the
token stream for fenced `json-action` blocks) and **§5** (`ServerEvent` carries a
pre-parsed `{ type: "action"; action }`). These can't both be the design.

Decide:

- **Who extracts actions** — the server (parse the provider stream, emit `action`
  events, send only prose as tokens) **or** the client (parse `json-action`
  fences from the accumulating token buffer)? State the tradeoff and the choice.
- **The exact wire format** for actions under the chosen owner.
- **Keeping actions out of the visible message** — stripped before render, or
  never sent as prose in the first place? (Users must not see raw action JSON.)
- **"Complete action block" detection mid-stream** — balanced fences, balanced
  braces, or a sentinel? How to avoid false positives on the model's ordinary
  fenced code blocks.
- **Partial / malformed action JSON** — discard, log, or surface?

This is the keystone of the action subsystem: the executor's input contract
(ticket 07) depends on it. PLAN refs: §3.4, §5.
