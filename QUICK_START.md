# Mini-Chat — Quick Start

Get a working chat-agent widget embedded on a new site in ~15 minutes.

`README.md` documents every env var, action, and behavior in detail. This guide
walks just the path for an integrator who wants a live chat on a site today.

## 0. What you need

- Node 18+
- A OpenAI-compatible LLM key (OpenRouter is the easiest — any provider with a
  `POST {base}/v1/chat/completions` works). Or skip this to try the offline
  mode first.
- A place to host the Node backend (any host that runs Node — a VPS, a small
  container, a PaaS). Pick your favorite; nothing here is host-specific.

## 1. Run it locally

```bash
git clone <this repo>
cd mini-chat
npm install
cp server/.env.example server/.env
npm run build                  # bundles the widget → client/dist/mini-chat.js
```

Edit `server/.env`:

```env
PROVIDER=fake                  # offline scripted model — no key needed yet
```

```bash
npm run dev                    # → http://localhost:8787
```

Open **http://localhost:8787/demo/index.html** — a four-page demo site (Home ·
Pricing · About · Contact). Click the orb, ask anything. Navigate between pages
and watch the conversation follow you via `localStorage`.

The widget is React + Shadow DOM; a single IIFE bundle; no CDN.

## 2. Plug in a real model

Get an OpenAI-compatible key (OpenRouter is one click to sign up and covers
dozens of models with one key):

```env
PROVIDER=openai-compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-…
LLM_MODEL=openai/gpt-4o-mini    # any chat/completions model works
LLM_PRICE_PER_MTOK=0.20         # blended $/M tokens for the daily budget cap
```

Restart the server. Tail the traffic log in another terminal:

```bash
tail -f server/logs/llm.jsonl | jq
```

You should see a `request` and `response` line per turn, correlated by
`requestId`. If the JSONL stays empty, `LLM_LOG_ENABLED=false` was set
somewhere — unset it.

## 3. Teach it about your site

Two markdown files injected on every turn:

| File (default path) | What goes in it |
|---|---|
| `server/config/system-prompt.md` | Personality, tone, behavior. Keep it short. |
| `server/knowledge/source.md` | Facts the assistant must answer from — pricing, FAQs, policies, site map. |

Edit both, then ask the assistant something only your knowledge file can answer
to confirm it landed. Keep `source.md` modest — it's wholesale-injected into
every turn and consumes context window. RAG / chunking is phase 2.

## 4. Verify it works

```bash
npm run verify:mount    # jsdom smoke test: bundle mounts, panel opens on Enter
npm run verify:e2e      # scripted SSE turn through the real page (~20 assertions)
npm run verify:mobile   # CDP device emulation: portrait, landscape, keyboard
```

All three should print `ALL PASS`. `verify:mount` and `verify:e2e` need the
demo running (`PROVIDER=fake` is fine — they use the offline scripted model).

## 5. Embed on your real site

Pick the URL your backend will live at (e.g. `https://chat.example.com`). Update
`server/.env`:

```env
ALLOWED_ORIGINS=https://www.example.com
PORT=8787
```

Restart. The server already serves the bundle at `/mini-chat.js`. Pick the
form that fits your build:

**Programmatic** (most flexible):

```html
<script src="https://chat.example.com/mini-chat.js" defer></script>
<script>
  MiniChat.init({
    backendUrl: "https://chat.example.com",
    agentId: "default",
    title: "Site assistant",
    accentColor: "#6d28d9",
  });
</script>
```

**Declarative** (no JS needed):

```html
<script src="https://chat.example.com/mini-chat.js"
        data-backend-url="https://chat.example.com"
        data-title="Site assistant"
        data-accent="#6d28d9"></script>
```

Either way: one `<script>` tag, in your `<head>` or end of `<body>`. That's it.

Config precedence per setting: `MiniChat.init({...})` → `window.MiniChatConfig`
→ `data-*` attributes → defaults.

The widget mounts **inside a Shadow DOM host** it appends to `<body>`; it does
not touch your DOM, CSS, or any element selectors. Page perception scans your
`<h1>`–`<h3>`, `<section id>`, and `[data-mini-section]` elements to ground
the assistant's answers in what the visitor is actually reading.

## 6. Promote the embed to live

Before flipping DNS, run through this list:

- `ALLOWED_ORIGINS` includes the production domain (and `www.` if you use it).
- API key is in the backend env, never exposed to the browser.
- The dev `.env` with the fake key isn't checked in (`.gitignore` covers it).
- Https end-to-end — the widget uses SSE and `fetch` and needs same-origin or
  CORS. The server sets the right headers; just terminate TLS upstream.
- The `logs/` directory is writable; the server creates it lazily on first
  request and `tail -f`s are reliable.
- A daily-spend cap (`BUDGET_CAP_DAILY_USD`, default $5) gates runaway prompts.

## Common first-day issues

| Symptom | Cause | Fix |
|---|---|---|
| Browser console: `no backendUrl — pass it to MiniChat.init, MiniChatConfig, or data-backend-url` | Config not reaching `init()` (script loaded but `data-` attrs read before the script ran) | Use the `<script>...</script>` form above with the init call after the bundle loads, or use `defer`. |
| Network panel: 403 on `/api/sse` or `/api/chat` | `ALLOWED_ORIGINS` missing the embedding origin | Add it and restart. |
| Chat replies but the suggested action does nothing | Selector in the assistant's reply didn't match a unique element on the page, or `actionsEnabled` is off in the panel header | Check that the user-facing toggle is ON; selectors come from `h1–h3` / `section[id]` / `[data-mini-section]` only. |
| Raw `{"action":…}` appears in the chat | Model emitted JSON without a `json-action` fence (happens with smaller/older models) | Try a stronger model in `LLM_MODEL`, or accept and click "Clear chat". |
| 429 right away | You hit the per-IP rate limit (30/min default) | Raise `RATE_LIMIT_PER_IP_PER_MIN` or wait a minute. |
| 503, input disabled | Daily budget cap reached (`BUDGET_CAP_DAILY_USD`, default $5) | Wait for the day to roll, or raise the cap. |

## Where to go next

- **README.md** — full env table, every action + its guardrails, accessibility
  baseline, troubleshooting.
- **PLAN.md** — the architecture and design decisions (why each piece looks
  the way it does). Useful if you're about to extend the action set, change
  the provider, or add RAG.
- **`.scratch/mini-chat/issues/`** — the decision trail; one file per
  resolved design question, with the reasoning captured.

If a piece of this guide went stale, the failing file is usually the same one
README points at: **`server/src/config.ts`** (single source of truth for env
vars) and **`server/src/context.ts`** (system prompt + action vocabulary).
