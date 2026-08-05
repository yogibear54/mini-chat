# Research: Client markdown sanitization options

For ticket [02](../issues/02-client-markdown-sanitization.md). Feeds ticket 06
(markdown render safety & scope). Claims cited to primary sources.

## The XSS surface

Rendering **untrusted** LLM markdown as HTML risks XSS: `<script>`, inline event
handlers (`<img onerror=...>`), `javascript:` / `data:` URLs, raw `<iframe>`,
`<object>`/`<embed>`, etc. Any sink that turns markdown into executable HTML is
a vector. [DOMPurify](https://dompurify.org/);
[react-markdown README (security note)](https://github.com/remarkjs/react-markdown).

## react-markdown is safe-by-default — *unless* you add rehype-raw

- `react-markdown` parses markdown to a syntax tree and renders **React elements**
  — it does **not** use `dangerouslySetInnerHTML`. By default it does **not** parse
  raw/inlined HTML, so raw HTML in the markdown is shown as **inert text** (e.g.
  `<script>…</script>` renders literally, not executed).
  [react-markdown README](https://github.com/remarkjs/react-markdown);
  [Strapi: React Markdown security](https://strapi.io/blog/react-markdown-complete-guide-security-styling).
- **The footgun:** adding `rehype-raw` (to honor inline HTML) parses raw HTML into
  the AST — and **without** a sanitizer this reintroduces full XSS.
  [CopilotKit #3938 (XSS via rehype-raw)](https://github.com/CopilotKit/CopilotKit/issues/3938);
  [Brian Liang: XSS in markdown editors](https://medium.com/@brian3814/pitfall-of-potential-xss-in-markdown-editors-1d9e0d2df93a).
- The official guidance: *"To make sure the content is completely safe, even after
  what plugins do, use **rehype-sanitize**."*
  [react-markdown README](https://github.com/remarkjs/react-markdown).

## Option A — react-markdown + rehype-sanitize (recommended lean)

- Renders React elements from an allowlist schema (default = GFM-safe via
  `hast-util-sanitize`): strips scripts, event handlers, dangerous URL schemes,
  raw HTML. No HTML-string sink at all.
- Custom `components={{ a: ... }}` forces `target="_blank"` +
  `rel="noopener noreferrer"` on links.
- Add `rehype-raw` **only** if the agent must emit inline HTML — and then keep
  `rehype-sanitize` with a tight schema after it.

## Option B — marked (or markdown-it) + DOMPurify

- `marked` produces an HTML **string**; sanitize with `DOMPurify.sanitize(html,
  { ALLOWED_TAGS, ALLOWED_ATTR, FORBID_TAGS, FORBID_ATTR, ... })`; render via
  `dangerouslySetInnerHTML`. DOMPurify is mature, fast, and covers mXSS.
  [DOMPurify](https://dompurify.org/);
  [OneUptime: sanitize input in React](https://oneuptime.com/blog/post/2026-01-15-sanitize-user-input-react-injection/view).
- Lighter/faster than Option A, but **reintroduces an HTML-string sink**
  (`dangerouslySetInnerHTML`) — more care, and a Trusted-Types consideration.

## Link & scheme handling

- Force `target="_blank"` + `rel="noopener noreferrer"` (custom component in A;
  DOMPurify hook / ADD_ATTR in B).
- Block `javascript:` and risky `data:` schemes. `rehype-sanitize`'s default
  schema already allows only safe URL protocols (http, https, mailto, etc.);
  DOMPurify likewise defaults to safe protocols.

## Shadow DOM interaction

Rendering inside the widget's Shadow DOM provides **style** isolation, not script
isolation — any script that runs via XSS inside the shadow root still executes in
the page's origin. **Sanitization is still required**; it is orthogonal to Shadow
DOM. (Shadow DOM is a net positive: it scopes the chat CSS so host styles can't
break it and vice-versa.)

## Recommendation (input to ticket 06 — decision is ticket 06's)

**Option A: `react-markdown` + `rehype-sanitize`, no `rehype-raw`.** Safe-by-
default, React-idiomatic (no `dangerouslySetInnerHTML`), naturally constrained to
an allowlist, and a custom `a` component handles link target/rel. Revisit (add
`rehype-raw` + a tight sanitize schema) only if real inline-HTML rendering turns
out to be needed.
