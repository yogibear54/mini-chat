# Markdown render safety & scope

Type: grilling
Status: open
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
