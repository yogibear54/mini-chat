# Action execution policy & UX

Type: grilling
Status: resolved

## Question

Decide the concrete policy and feel of the sandboxed action executor — both the
safety boundary and the UX. Sub-questions:

- **Selector-validation rule.** Does the "section inventory" (from perception)
  contain *sections only*, or all scanned elements? Must a `scrollTo`/`highlight`
  selector resolve to an inventory entry, or just to any real DOM element? Make
  the rule explicit and consistent with ticket 09.
- **Rate cap.** Value (e.g. N actions / M seconds), per-action-type or global;
  what happens when exceeded (drop + log? user notice?).
- **Invalid-action handling.** Bad/unknown selector, unknown action type, nav
  blocked by same-origin — silent ignore, log, or user feedback?
- **`move` positioning.** How the orb is placed relative to a target (margin,
  avoid covering the target or overlapping it). The *mechanism*; aesthetics stay
  implementer-discretion.
- **`scrollTo` / `highlight` behavior.** Smooth scroll; `scrollIntoView` options;
  highlight default duration + visual mechanism (outline/overlay).
- **Action toggle.** Where it lives in the UI, whether it persists, default state.

Conceptually depends on ticket 04 for the parsed-action shape. PLAN refs: §3.4,
§3.5.

> **Cross-ref (from [ticket 04](./04-action-pipeline-ownership.md)):** the executor's input contract is now fixed — it receives client-parsed `Action` objects, one per complete `json-action` fence, in document order. **Also newly open here:** the **`say` action's purpose**. Greeting is now client-rendered (ticket 03) and push is gone, so `say`'s original "greeting/proactive" use is dead — decide: drop `say` from MVP, or keep it with a distinct meaning (e.g. a transient orb speech line vs. a normal chat message)?

## Answer

Decisions (locked for the spec):

1. **Selector-validation policy = free selectors (Option B)** with guardrails. A target must `querySelector` to **exactly one** element in the **host document**; it may **not** resolve inside the widget's own shadow DOM nor to a disallowed tag (`script`, `style`, `head`, `title`, `meta`, `link`, `template`, `noscript`). Zero/multiple/forbidden → invalid (Q2). Rationale: the widget is drop-in and can't rely on site owners pre-tagging elements, so free selectors let it act on any page out of the box. The section inventory is still scanned + injected into the LLM context for *reference* (→ ticket 09), but targets aren't restricted to it.
2. **Rate cap + invalid handling.** Global sliding cap **8 actions / 5 s**; exceeded → drop + `console.warn` (no toast). Invalid action (unknown type, unresolvable/multi/forbidden target, blocked nav) → **silent ignore + `console.warn`** (consistent with ticket 04).
3. **`navigate` = one-tap user confirmation.** scroll/highlight/move run immediately; navigate shows a confirm ("Assistant wants to take you to <path> — Let's go / Not now") before leaving the page. Same-origin-only (§3.4); confirmation is cheap safety on the one disruptive action.
4. **Action mechanics.** `scrollTo` → `scrollIntoView({behavior:"smooth", block:"center"})`. `highlight` → temporary outline/overlay, **~2 s** then auto-fade (duration configurable). `move` → orb glides **adjacent to (not overlapping) the target**, viewport-clamped. (Glide easing/offset → ticket 11 prototype; highlight *color* → implementer discretion.)
5. **Action toggle.** A control in the panel (settings/menu); **persists in `prefs`**; **default ON**. OFF → executor **no-ops** (actions parsed, prose renders, nothing run).
6. **`say` dropped from MVP.** Greeting is static (ticket 03), push gone; prose covers speaking and the orb's expressions (ticket 11) cover personality. Orb-speech-bubble is a phase-2 option. (Updates §2 action set + §3.4 vocabulary + §5 `Action` type.)

Cross-refs: [09](./09-perception-rules.md) (inventory scanned for context, not a target restriction), [10](./10-wire-protocol-semantics.md) (`Action` type drops `say`; keep section/selector target fields), [12](./12-client-ux-edge-cases.md) (navigate-confirm UI + action-toggle UI). `PLAN.md` §2/§3.4/§5 updated.
