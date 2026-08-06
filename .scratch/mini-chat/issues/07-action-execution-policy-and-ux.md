# Action execution policy & UX

Type: grilling
Status: open

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
