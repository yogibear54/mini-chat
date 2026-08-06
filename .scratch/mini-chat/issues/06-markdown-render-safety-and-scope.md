# Markdown render safety & scope

Type: grilling
Status: resolved
Blocked by: 02

## Question

Using the options from [ticket 02](./02-client-markdown-sanitization.md), decide
the chat panel's markdown rendering:

- **Renderer / sanitizer stack** — which library combination.
- **Allowed feature set** — headings, lists, links, inline code, fenced code
  blocks (syntax highlighting?), tables, images? Define the allowlist.
- **Link handling** — force new tab + `rel="noopener noreferrer"`; allowed URL
  schemes (block `javascript:`, `data:`?).
- **Render location** — relative to the Shadow DOM.
- Confirm the chosen setup closes the XSS surface from both LLM output and
  injected page context.

PLAN refs: §3.1, §4 (`chat-ui.tsx`).

> **Cross-ref (from [ticket 04](./04-action-pipeline-ownership.md)):** the renderer must **suppress `json-action`-tagged fences entirely** (never render them). The action scanner and the markdown renderer share the token buffer — coordinate them so action blocks are excluded from rendered prose while still parsed for execution.

## Answer

Decisions (locked for the spec):

1. **Stack** — `react-markdown` + `rehype-sanitize`, **no `rehype-raw`** (raw HTML renders as inert text; the sanitize schema is the allowlist). Rendered inside the widget's Shadow DOM, styled by scoped shadow-root CSS. (Alternative `marked`+`DOMPurify` rejected — reintroduces an HTML-string sink / `dangerouslySetInnerHTML`.)
2. **Feature allowlist** — enable `remark-gfm` (tables, strikethrough, autolinks, task-lists). Render: emphasis, inline code, fenced code blocks (**plain monospace — no syntax highlighting**), lists, blockquote, links, headings, tables. **Block images** (external-image loading leaks IP/read-timing — the tracking-pixel problem; sanitizer covers script injection but not the privacy leak). **Defer syntax highlighting** (bundle cost).
3. **Link & scheme handling** — custom `a` forces `target="_blank"` + `rel="noopener noreferrer"` (reverse-tabnabbing + referrer protection). Schemes: **http, https, mailto, tel** only (add `tel` to the default schema); block `javascript:` / `data:` / `vbscript:` / `file:`.
4. **`json-action` suppression** (ticket 04) — the action **scanner owns fence detection**, emits **cleaned prose** (action fences removed) to the renderer, dispatches actions separately. `react-markdown` renders only the cleaned buffer; mid-stream it renders the safe prefix while a fence is open-but-unclosed.

Confirms the XSS surface (LLM output + injected page context) is closed: no-raw-HTML default + sanitize allowlist + scheme guard.

`PLAN.md` §2 (+Chat rendering row), new §3.7, §4 (`chat-ui.tsx`) updated.
