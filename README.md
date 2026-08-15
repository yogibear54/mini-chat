# Mini-Chat

A drop-in, expressive chat-agent widget for any site. One `<script>` tag mounts
a floating orb that chats with an LLM, **knows which section of the page you're
reading**, can **scroll / highlight / navigate** for you, **moves itself** near
what it's showing you, and **remembers the conversation** across pages via
`localStorage`.

The spec of record is [`PLAN.md`](./PLAN.md) — decision-complete, with the
decision trail in [`.scratch/mini-chat/map.md`](./.scratch/mini-chat/map.md).

```
browser ── POST /api/chat ──► backend proxy ──► LLM (OpenAI-compatible)
   ▲                              │
   └──── SSE tokens (fan-out) ────┘
```

## Quick start (demo)

```bash
npm install
npm run build                # builds client/dist/mini-chat.js (IIFE, React bundled)
cp server/.env.example server/.env
# offline demo — no API key needed:
#   edit server/.env → PROVIDER=fake
npm run dev                  # backend on http://localhost:8787
```

Open **http://localhost:8787/demo/index.html** — a multi-section host page with
the orb embedded. `demo/spa.html` exercises SPA route re-scanning. Chat, watch
it scroll/highlight, navigate between pages and see the conversation persist.

## Embedding on your site

```html
<script src="https://your-backend/mini-chat.js"></script>
<script>
  MiniChat.init({
    backendUrl: "https://your-backend",
    agentId: "default",
    title: "Assistant",
    accentColor: "#6d28d9",
    greetingText: "Hi! Need help?",   // optional — falls back to the server's GREETING_TEXT
  });
</script>
```

Or fully declarative on the script tag:

```html
<script src="https://your-backend/mini-chat.js"
        data-backend-url="https://your-backend"
        data-title="Assistant"
        data-accent="#6d28d9"></script>
```

**Config precedence** (per setting): `MiniChat.init({...})` → `window.MiniChatConfig`
→ `data-*` attributes → defaults.

### Server `.env`

See [`server/.env.example`](./server/.env.example). Key knobs:

| Var | Meaning |
|---|---|
| `ALLOWED_ORIGINS` | CORS allowlist — your site's origins |
| `RATE_LIMIT_PER_IP_PER_MIN` | chat turns per IP per minute (default 30 → `429`) |
| `BUDGET_CAP_DAILY_USD` | daily LLM spend cap (default $5 → `503`) |
| `PROVIDER` | `openai-compatible` (default) or `fake` (offline demo) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | any OpenAI-compatible endpoint |
| `SYSTEM_PROMPT_PATH` / `SOURCE_OF_TRUTH_PATH` | the agent's prompt + knowledge markdown |
| `GREETING_TEXT` | fallback greeting (client-rendered — no LLM call) |

## How it behaves

- **Streaming chat** over one SSE connection per tab (`GET /api/sse?sessionId=…`);
  replies fan out to **all tabs** of a session. Reconnect is automatic; a
  watchdog redials silent mid-turn stalls. Dropped turns show a Retry button.
- **Page perception**: scans `h1–h3`, `section[id]`, `[data-mini-section]`;
  tracks the current section (middle-band `IntersectionObserver`); re-scans on
  SPA route changes. Sent with every message.
- **Actions** (LLM-emitted, `json-action` fences parsed client-side, stripped
  from the rendered text): `scrollTo`, `highlight`, `move` (self), `navigate`
  (same-origin only, one-tap confirmation). Free selectors, guarded: must match
  exactly one host element, never inside the widget, never forbidden tags.
  Rate-capped at 8 actions / 5 s. Users can disable actions from the panel
  header (persisted).
- **Memory**: `localStorage` per origin — full conversation survives page
  navigations until cleared; rolling caps (≤100 messages / ≤100 KB); "Clear
  chat" wipes history and rotates the session id but keeps preferences.
- **Errors**: friendly inline messages only — rate-limit asks you to slow down,
  budget-cap disables the input until tomorrow, network errors offer Retry.
- **Accessibility**: the orb is a real button (Enter/Space opens), focus
  management on open/close, polite live region, `prefers-reduced-motion`
  disables glide/bob, Esc closes.

## Adding a provider

Providers live in `server/src/providers/`:

1. Implement `ChatProvider` (`stream(req, signal)` async-iterating
   `{ type: "token" }` / `{ type: "usage" }` chunks) — see `openai-compatible.ts`.
2. Register it in `registry.ts`.
3. Point `PROVIDER` at it in `.env`.

`fake.ts` is a complete 30-line example (also used by the tests and offline demo).

## Development

```bash
npm test          # vitest — 61 tests across the six agreed seams
npm run typecheck # tsc across shared/server/client
npm run build     # vite IIFE build of the widget
npm run dev       # backend with tsx watch
```

Layout: `shared/types.ts` (wire protocol) · `client/src/*` (widget; React,
Shadow DOM) · `server/src/*` (proxy; plain Node http, no runtime deps).

## Safety notes

The API key lives only on the backend; the browser never sees it. LLM output is
rendered with `react-markdown` + `rehype-sanitize` (no raw HTML; schemes limited
to http/https/mailto/tel; links open new-tab with `noopener`). LLM-emitted DOM
actions are an injection surface — the executor enforces a strict allowlist,
guarded selectors, same-origin navigation behind user confirmation, and a rate
cap. Expand the action set with care.
