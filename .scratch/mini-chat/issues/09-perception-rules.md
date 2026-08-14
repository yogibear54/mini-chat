# Perception rules

Type: grilling
Status: resolved

## Question

Decide the perception module's rules. Sub-questions:

- **Section scanning.** Confirm selectors (`h1, h2, h3, section[id],
  [data-mini-section]`); **label derivation** (`innerText`? `aria-label`?
  truncated to N chars?); **id auto-assignment** scheme + collision handling.
- **Current-section algorithm.** `IntersectionObserver` threshold / `rootMargin`;
  how "current" is picked (largest intersection? topmost in view?); scroll
  debounce.
- **Section-change propagation.** Since the backend is stateless on history, do
  section changes just update client state for the next message, or is there a
  live context-push to the server? If live, over what channel?
- **Re-scan triggers.** Load only, or `MutationObserver` for SPAs? (MVP targets
  static multi-page sites per `PLAN.md` — state the assumption explicitly.)

PLAN ref: §3.3.

> **Cross-ref (from [ticket 07](./07-action-execution-policy-and-ux.md)):** targets are **not** restricted to the inventory — selectors are free (must match exactly one host element, guarded). The inventory is still scanned + injected into the LLM context for *reference* (so the model knows section ids/labels to cite), but the executor accepts any valid one-match selector.

## Answer

Decisions (locked for the spec):

1. **Scanning, labels, ids** — selectors `h1, h2, h3, section[id], [data-mini-section]`. Label priority: `aria-label` → `data-mini-label` → heading text (or first descendant heading) → id; truncated ~80 chars. id: use the element's existing id if present; else auto-assign a **namespaced** slug `mini-s-<slugified-label>` (collision-suffixed, validity-prefixed) — the `mini-s-` prefix keeps our auto-ids off the host page's namespace; we only add, never mutate existing ids.
2. **Current section** — `IntersectionObserver` central active band (`rootMargin: "-40% 0px -40% 0px"`, `threshold: 0`); topmost active section wins; debounce ~150 ms.
3. **Section-change propagation** — **client-local only**; `currentSectionId` rides the next `/api/chat` POST's `pageContext` (no live push; backend stateless + agent reactive).
4. **Re-scan triggers — Option C (SPA route-change support).** Scan on load **and** re-scan on SPA route/URL changes (`popstate` + `hashchange` + a `history.pushState`/`replaceState` hook). Re-scans keep ids stable (sections tracked by element via a `WeakMap`) and re-attach the `IntersectionObserver`. **Full fine-grained `MutationObserver` content-watcher (intra-route dynamic sections) deferred** — add only if real SPAs show stale-section issues. *(Chosen over A/static-only because the widget is for public consumption and should support SPAs; over B/full to avoid the content-watcher's thrash/leak/id-churn testing burden for MVP.)*

Inventory is **reference-only** (ticket 07) — it grounds the LLM; action targets aren't restricted to it.

`PLAN.md` §3.3 rewritten; §10 DoD updated to include SPA support. Map "Not yet specified" notes the deferred content-watcher.
