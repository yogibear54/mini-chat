# Perception rules

Type: grilling
Status: open

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
