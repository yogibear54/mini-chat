# Action pipeline ownership

Type: grilling
Status: resolved

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

## Answer

Decisions (locked for the spec):

1. **Ownership = client parses (Option C).** The backend is a dumb pass-through — it forwards every upstream token on the `token` channel and does **not** parse content. The client scans the accumulating token buffer for `json-action` fences, suppresses them from the rendered message, and dispatches each parsed action to the sandbox. Rationale: the action sandbox is fundamentally client-side (only the client knows the host page); server-side parsing would add a content-parser to the server for only a coarse allowlist's worth of defense-in-depth. Keeps the server = provider-abstraction + abuse gate; smoothest streaming; aligns with §3.4.
2. **`ServerEvent.action` removed.** `token` is the only content channel; actions ride inside the prose stream as `json-action` fences. (→ ticket 10.)
3. **Block contract:** a fence tagged exactly `json-action` (case-sensitive), closed per CommonMark; **one `Action` object per block**; multiple blocks in document order; complete = closing fence seen → parse; **only `json-action` fences execute** (all other code fences render normally, never execute); fire **on block-complete**, mid-stream, in order.
4. **Malformed/partial:** invalid JSON or unclosed fence → discard + `console.warn`, never shown; UI silent. Bad action shape / unknown type → rejected by the executor (ticket 07).

Cross-refs (updated): [06](./06-markdown-render-safety-and-scope.md) (renderer must suppress `json-action` fences — scanner + renderer share the buffer), [07](./07-action-execution-policy-and-ux.md) (input contract fixed; **`say` purpose now open**), [08](./08-memory-policy.md) (persist cleaned prose, not raw stream), [10](./10-wire-protocol-semantics.md) (`ServerEvent.action` removed; open: does the final `message` carry cleaned prose or does the client clean its buffer?). `PLAN.md` §3.4/§5 updated.
