# Client markdown sanitization options

Type: research
Status: resolved

## Question

Gather primary-source facts to decide how Mini-Chat's chat panel renders LLM
markdown safely (ticket 06). Specifically:

- **The XSS surface** of rendering untrusted LLM markdown to HTML in-browser
  (`<img onerror>`, `javascript:` URLs, `<script>`, mutation XSS, data URIs).
- **Library options for React:** DOMPurify + a parser (marked / markdown-it) vs
  `react-markdown` + `rehype-sanitize`. What each sanitizes, its defaults, bundle
  cost, and whether it produces React elements (no `dangerouslySetInnerHTML`).
- **Link handling** — forcing `target="_blank"` + `rel="noopener noreferrer"`,
  and restricting URL schemes.
- **Shadow-DOM interaction** — the widget already renders inside a Shadow DOM;
  any implications for sanitization/styles.

Cite primary sources (DOMPurify GitHub/docs, `react-markdown`, `rehype-sanitize`,
OWASP XSS prevention cheat sheet). Write findings to
`.scratch/mini-chat/research/client-markdown-sanitization.md`.

Feeds: ticket 06 (markdown render safety & scope).

## Answer

Findings in [research/client-markdown-sanitization.md](../research/client-markdown-sanitization.md) (primary-source cited). Headlines:

- **react-markdown is safe-by-default** — renders React elements (no `dangerouslySetInnerHTML`) and ignores raw HTML unless `rehype-raw` is added. The footgun is `rehype-raw` *without* a sanitizer (real XSS — see CopilotKit #3938).
- **Recommended: `react-markdown` + `rehype-sanitize`, no `rehype-raw`.** Allowlist schema strips scripts/handlers/dangerous URL schemes; a custom `a` component forces `target="_blank"` + `rel="noopener noreferrer"`.
- Alternative: `marked` + `DOMPurify` (lighter, but reintroduces an HTML-string sink).
- **Shadow DOM doesn't replace sanitization** — it isolates style, not script; XSS in a shadow root still runs in the page origin.

Unblocks ticket 06.
