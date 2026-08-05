# Mini-Chat — On-Page Agent Plan

A small, drop-in chat component for any site (including plain HTML/CSS pages).
It is an **expressive, context-aware agent** — not just a chat box — that
perceives the page it lives on, can act on it, glides itself to relevant
sections, and remembers the conversation across page navigations.

Built in **TypeScript**, with a configurable, extensible **provider pattern**
for the LLM.

---

## 1. Vision

A single `<script>` tag on any HTML page mounts a floating "orb" agent that:

- Chats with an LLM (ChatGPT-style, streaming, two-way).
- **Knows where the user is** on the page (current section) and answers with
  that context.
- **Can guide the user**: scroll to a section, highlight an element, navigate
  within the site.
- **Moves itself**: glides near the section it's guiding the user to, with an
  idle bob and expressive reactions.
- **Remembers** the conversation as the user moves from page to page.

---

## 2. Key Decisions (locked)

| Area | Decision |
|---|---|
| Distribution | Standalone `<script>` widget (Shadow-DOM isolated, React bundled in). No host React required. |
| LLM access | Small backend proxy holds the API key; browser never sees it. |
| Provider | **Extensible provider pattern**; first impl = OpenAI-compatible (OpenAI, OpenRouter, Replicate-compat, Groq, …). |
| Streaming | Streamed responses via SSE (token-by-token). |
| Bidirectionality | SSE channel carries **streamed tokens** (one-way server → client). Server-initiated push is **out of MVP** (reactive autonomy; see §3.2). |
| Abuse protection | Origin allowlist + per-IP rate limit + daily budget cap; no `/api/push` (see §3.2.1). |
| Autonomy | **Context-aware reactive** — uses page context and acts when engaged; does not initiate unprompted (greeting on open is fine). |
| Actions (MVP) | `scrollTo`, `highlight`, `navigate` (same-origin), `move` (self), `say` — all sandboxed. |
| Body | Expressive SVG **orb/face** with expression states (idle/thinking/speaking/looking/done) and eyes that orient toward the action target. |
| Movement | Glides near the relevant section when guiding, plus idle bob. |
| Source of truth | A **markdown file** (`knowledge/source.md`) loaded by the backend and injected into the system context. |
| System prompt | Configurable per agent. |
| Memory | **localStorage** (single-origin), **indefinite** retention until cleared, with a rolling cap. |

---

## 3. Architecture

### 3.1 High-level

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Host page (any site)        │        │  Backend proxy (Node + TS)    │
│                              │        │                               │
│  <script src="mini-chat.js"> │        │  - holds LLM API key          │
│   │                          │        │  - loads source.md            │
│   └─ Shadow DOM widget       │ ◄────► │  - assembles system context   │
│       ├ orb (SVG)            │  SSE   │  - provider abstraction       │
│       ├ chat panel           │  POST  │  - sessions map (open SSE)    │
│       ├ movement engine      │        │                               │
│       ├ perception           │        │  Providers:                   │
│       ├ actions (sandbox)    │        │   • openai-compatible         │
│       └ storage (localStorage)│       │   • … (extensible)            │
└─────────────────────────────┘        └───────────────┬──────────────┘
                                                        │
                                                        ▼
                                               LLM (OpenRouter /
                                                Replicate-compat / …)
```

### 3.2 The bidirectional channel (SSE)

One persistent SSE connection per widget instance is the single transport for
**all server → client** traffic:

- `GET /api/sse?sessionId=X` → persistent stream. Server validates origin
  (CORS), registers the stream in a `sessions` map.

Client → server uses `POST`:

- `POST /api/chat { sessionId, history[], message, pageContext }` → 202; the
  LLM response streams back down the SSE channel.

> The backend is **stateless regarding conversation history** (the client sends
> full history each turn). The only server state is the `sessionId → open SSE
> stream` map.

> **No `/api/push` in MVP.** Autonomy is reactive (§2), so the server never
> initiates. The **greeting is client-rendered**: on first open with empty
> history the widget shows `GREETING_TEXT` locally as the first assistant
> message — no LLM call, no latency, no push channel to secure. (Server-initiated
> push is a deliberate phase-2 capability, with real auth.)

#### 3.2.1 Abuse protection & trust (MVP)

- **Origin allowlist** (`ALLOWED_ORIGINS`) — the legitimate-host gate; CORS
  stops browser-based cross-origin abuse.
- **Per-IP rate limit** on `/api/chat` — default **30 messages/min/IP**, in-memory,
  configurable. Counts chat *turns* (POSTs), not tokens. Exceeded → `429`.
- **Daily budget cap** — server-side, hard-stop new requests when the day's
  provider spend exceeds the cap (default **$5/day**, configurable). Exceeded →
  `503` (disabled; resets daily). Measure spend from the provider's usage in the
  final streaming chunk (`stream_options.include_usage`) when available, else
  estimate tokens.
- **No site token** for MVP (defense-in-depth, deferred).
- **`sessionId` trust** — client-generated UUIDv4, blindly keying the `sessions`
  map (acceptable for MVP). Residual risk: a same-origin script that can read
  `localStorage` can impersonate (the pre-existing XSS caveat, §3.6); the daily
  cap is the backstop. Server-issued `httpOnly` cookie binding deferred to phase 2.
- Caveats: in-memory rate-limit state is **single-instance** (multi-instance
  needs a shared store like Redis — deployment-dependent); per-IP has the usual
  CGNAT/IPv6 caveats.

### 3.3 Perception (client → server context)

A `perception` module reads the host page (the widget shares the page's DOM/JS
context because it's injected into the page, **not** an iframe):

- Scans sections: `h1, h2, h3, section[id], [data-mini-section]`
  (auto-assigns ids where missing).
- Tracks the **current section** via `IntersectionObserver`.
- Builds `PageContext = { url, title, path, metaDescription, sections[], currentSectionId }`.
- Sent with each message (and on section change). The backend injects it into
  the system context.

> This is why the widget must inject into the page (Shadow DOM for style
> isolation) rather than use an iframe — an iframe cannot read the parent page.

### 3.4 Action protocol (server → client)

The LLM emits **fenced `json-action` blocks** in its stream. The client streams
prose to the chat bubble, scans the accumulating buffer for complete action
blocks, and dispatches them to a **sandboxed executor**.

Action vocabulary (MVP allowlist):

```jsonc
{ "action": "scrollTo",   "sectionId": "pricing" }          // or { "selector": "..." }
{ "action": "highlight",  "selector": "#plans" }
{ "action": "navigate",   "path": "/about" }                // same-origin only
{ "action": "move",       "near": "pricing" }               // sectionId | selector | corner | coords
{ "action": "say",        "text": "Hi! Need help?" }        // greeting / proactive line
```

**Safety (enforced by the executor):**
- Strict action allowlist — unknown actions are ignored.
- Selectors/sectionIds validated against the **scanned section inventory**.
- `navigate` restricted to **same-origin** paths.
- **Never** `eval` or run arbitrary JS.
- Per-action **rate cap**; user can disable actions via a toggle.

> This format is **provider-agnostic** — it works with any OpenAI-compatible
> model regardless of tool/function-calling support. (Tool calling is a future
> optimization.)

### 3.5 Movement & expression

- Widget root is `position: fixed` with `will-change: transform`; a movement
  engine sets `transform` with a CSS easing transition (glide).
- An inner element runs a continuous CSS keyframe for the **idle bob** (so it
  doesn't fight the position transform).
- The SVG **orb** has expression states driven by chat state:
  `idle`, `thinking` (awaiting/streaming), `speaking` (streaming tokens),
  `looking` (orient eyes toward the current action target), `done`.
- A `move` action glides the orb to a viewport position near the target.

### 3.6 Memory (localStorage)

- Single-origin, indefinite retention until cleared (with a rolling cap to
  respect the ~5MB limit).
- Stored under `mini-chat:{agentId}`:
  ```jsonc
  { "sessionId": "…", "createdAt": 0, "history": [ /* ChatMessage[] */ ], "prefs": {} }
  ```
- Behind a small `Memory` interface (`load` / `save` / `clear`) so a future
  backend-sync implementation is a drop-in swap.

**Gotchas handled:**
- ~5MB limit → rolling cap (last ~100 messages / ~100KB; drop oldest).
- Private mode / disabled storage → try/catch → in-memory fallback.
- Corrupt data → validate JSON shape → reset if invalid.
- Multi-tab → `storage` event keeps history in sync across tabs (live SSE push
  channel binds to the most-recently-connected tab — known MVP limitation).
- Navigation gap → on a full page reload the SSE connection drops and
  reconnects; any proactive push sent during that gap is lost without a backend
  queue (phase 2).
- Security → no secrets stored; chat content is readable by any script on the
  origin (acceptable for MVP). Standard XSS caveat applies.

> `localStorage` is **per-origin** — perfect for one multi-page domain. It does
> **not** cross domains/subdomains; cross-origin continuity requires backend
> storage (phase 2).

---

## 4. Project Structure

```
mini-chat/
├── shared/
│   └── types.ts            # wire types (single source of truth)
├── client/                 # drop-in widget (React + Vite, IIFE build)
│   └── src/
│       ├── widget.tsx      # mounts shadow root; orb + panel; orchestration
│       ├── orb.tsx         # SVG expressive orb (states + eye orientation)
│       ├── movement.ts     # glide engine + idle bob
│       ├── perception.ts   # scan sections, IntersectionObserver, PageContext
│       ├── actions.ts      # parse json-action blocks + sandboxed executor
│       ├── useChat.ts      # SSE client, history, rehydrate/persist, expression state
│       ├── storage.ts      # Memory interface + localStorage impl
│       ├── chat-ui.tsx     # panel: messages, streaming, markdown render
│       └── styles.css      # scoped inside shadow root
│   └── vite.config.ts      # IIFE, React inlined, auto-mount
├── server/                 # backend proxy (Node + TS, minimal deps)
│   └── src/
│       ├── index.ts        # http: /api/sse, /api/chat, /api/push; CORS; OPTIONS
│       ├── config.ts       # .env + agent config (system prompt, source md, provider, action policy)
│       ├── sessions.ts     # sessionId -> open SSE stream
│       ├── context.ts      # load source.md; assemble system context + action vocabulary + history windowing
│       └── providers/
│           ├── types.ts    # ChatProvider interface + stream shape
│           ├── openai-compatible.ts
│           └── registry.ts # provider factory/registry (extensibility point)
│   ├── knowledge/
│   │   └── source.md       # the markdown source of truth
│   └── .env.example
└── README.md               # embed snippet + config reference
```

---

## 5. Wire Protocol

```ts
// shared/types.ts

interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

interface PageContext {
  url: string; title: string; path: string;
  metaDescription?: string;
  sections: { id: string; label: string }[];
  currentSectionId?: string;
}

type Action =
  | { action: "scrollTo";   sectionId?: string; selector?: string }
  | { action: "highlight";  selector: string; durationMs?: number }
  | { action: "navigate";   path: string }
  | { action: "move";       near: string }   // sectionId | selector | corner | "x,y"
  | { action: "say";        text: string };

interface ChatRequest {
  agentId: string;
  history: ChatMessage[];   // prior messages (system message injected by backend)
  message: string;          // new user message
  pageContext: PageContext;
}

type ServerEvent =
  | { type: "token";  value: string }
  | { type: "message"; message: ChatMessage }   // complete or server-initiated
  | { type: "action"; action: Action }           // optional: pre-parsed actions
  | { type: "done";   requestId: string }
  | { type: "error";  message: string };
```

---

## 6. Configuration

### Backend (`.env`)
```
PORT=8787
ALLOWED_ORIGINS=https://example.com,http://localhost:5173

# Abuse protection (ticket 03)
RATE_LIMIT_PER_IP_PER_MIN=30
BUDGET_CAP_DAILY_USD=5

# Provider (OpenAI-compatible by default)
PROVIDER=openai-compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-...
LLM_MODEL=openai/gpt-4o-mini

# Agent
SYSTEM_PROMPT_PATH=./config/system-prompt.md
SOURCE_OF_TRUTH_PATH=./knowledge/source.md
GREETING_TEXT=Hi! I'm the site assistant — ask me anything.
```

### Frontend (init)
```html
<script src="https://your-host/mini-chat.js"></script>
<script>
  MiniChat.init({
    backendUrl: "https://your-backend",
    agentId: "default",
    title: "Assistant",
    accentColor: "#6d28d9"
  });
</script>
```
(Also readable from `data-*` attributes on the script tag.)

---

## 7. Scope

### In scope (MVP)
- Drop-in `<script>` widget, Shadow-DOM isolated, React bundled.
- Streaming two-way chat with an OpenAI-compatible provider.
- Extensible provider pattern (add a provider = implement interface + register).
- Configurable system prompt + markdown source of truth.
- Page perception (sections, current section) injected into context.
- Sandboxed actions: `scrollTo`, `highlight`, `navigate` (same-origin), `move`, `say`.
- Expressive SVG orb with reaction states; glides to guide; idle bob.
- Backend proxy: SSE + chat, CORS allowlist + OPTIONS, per-IP rate limit, daily budget cap (no `/api/push` in MVP).
- localStorage memory: single-origin, indefinite, rolling cap, multi-tab sync.
- Greeting on open (gated to empty history); "Clear chat" control.
- README with embed snippet + "add a provider" guide.

### Out of scope (future)
- Proactive observer / unprompted initiation beyond greeting.
- Server-initiated push channel (`/api/push`) and per-user / cookie-bound sessions — phase 2.
- Free-roaming wander; full rigged mascot character.
- RAG / chunking over large knowledge (currently injected wholesale).
- Backend-side persistence / cross-device & cross-origin memory.
- Auth, multi-user, rate-limiting beyond a basic per-action cap.
- Multi-agent routing by `agentId` (structure supports it; single config for MVP).
- Tool/function-calling optimization; backend message queue for navigation gaps.

---

## 8. Assumptions

- **Node 18+** (global `fetch`); npm as the package manager.
- Provider config via server `.env` (OpenAI-compatible default).
- Markdown source-of-truth injected **wholesale** into the system context
  (chunking/RAG is phase 2).
- Single-agent config for MVP; `agentId` routing is a near-term extension.
- One configurable accent color + title.

---

## 9. Implementation Plan

Each step has a verification criterion.

1. **Scaffold monorepo + tooling** — `client/`, `server/`, `shared/` with TS
   path alias `@shared/*`; React+Vite (client), plain Node `http` + TS (server).
   → verify: both typecheck, installs clean.
2. **Define shared wire types** (`shared/types.ts`: `ChatMessage`, `ChatRequest`,
   `ServerEvent`, `PageContext`, `Action`, `StoredSession`). → verify: both apps
   import and compile.
3. **Provider abstraction + OpenAI-compatible provider**
   (`providers/{types,registry,openai-compatible}.ts`, streaming). → verify:
   standalone script streams a real completion from OpenRouter via `.env`.
4. **Backend context + config** (`config.ts`, `context.ts`): load
   `knowledge/source.md`; assemble system context incl. action vocabulary;
   apply history windowing. → verify: logs assembled system message + truncated
   history.
5. **Backend HTTP + SSE + sessions** (`index.ts`, `sessions.ts`): `/api/sse`,
   `/api/chat`, `/api/push`; CORS allowlist + OPTIONS. → verify: `curl` SSE +
   `POST /api/chat` streams tokens; `POST /api/push` delivers a message.
6. **Client perception layer** (`perception.ts`): scan sections,
   `IntersectionObserver` → `PageContext`. → verify: logs `PageContext` while
   scrolling a test page.
7. **Client action executor + stream parser** (`actions.ts`): parse
   `json-action` blocks; sandboxed execution with selector allowlist,
   same-origin nav, rate cap, toggle. → verify: synthetic action stream
   scrolls/highlights/navigates/moves on a test page.
8. **Movement + expression engine** (`movement.ts`, `orb.tsx`): `position:fixed`
   glide + idle bob; SVG orb states + eye orientation. → verify:
   `moveTo('#pricing')` glides; states animate during a simulated chat.
9. **Client memory layer** (`storage.ts`): `Memory` interface (`load/save/clear`);
   localStorage impl keyed `mini-chat:{agentId}` storing
   `{sessionId, createdAt, history[], prefs}`; try/catch → in-memory fallback;
   JSON validation; rolling cap; `storage`-event tab sync. → verify: messages
   survive reload; cap drops old entries; corrupt key recovers; two tabs sync.
10. **Client SSE hook** (`useChat.ts`): on init **rehydrate** from `storage`
    (history + sessionId); reconnect SSE with the stored sessionId; send
    `{history, message, pageContext}` per turn; **persist** on change; drive
    expression states; feed buffer to action parser. → verify: a real
    conversation survives a hard reload and continues the same thread.
11. **Widget shell + panel UI** (`widget.tsx`, `chat-ui.tsx`, `styles.css`):
    Shadow-DOM mount, floating orb, open/close panel, message list, markdown
    render, input; greeting fires only when stored history is empty; "Clear
    chat" wired to `storage.clear()`. → verify: looks ChatGPT-ish, opens/closes,
    streams, glides, and clearing wipes localStorage.
12. **Vite IIFE build + config bootstrap**: React inlined, auto-mount, config
    from `window.MiniChatConfig` or `data-*`. → verify: a plain `index.html`
    with one `<script>` runs the full agent with zero host React.
13. **README**: embed snippet, `.env` reference, "add a provider" guide,
    action-allowlist/safety notes, memory model (localStorage, per-origin, cap,
    clear, upgrade path). → verify: fresh clone → run backend → drop snippet →
    chat survives navigation across pages of a multi-page static site end-to-end.

---

## 10. Definition of Done

A static page with one `<script>` tag hosts an expressive orb agent that:

- chats with an OpenAI-compatible model and streams answers,
- answers informed by the **current page section** and the **markdown source**,
- can **scroll / highlight / navigate** you and **glide itself** to the relevant
  section,
- **remembers the full conversation as you move from page to page** via
  localStorage, until you clear it,

— all configurable via backend `.env` (provider/model/key/system-prompt/source
file) and frontend init (`backendUrl`, `agentId`, accent/title).

---

## 11. Risks / Open Items

- **Action safety**: LLM-emitted DOM actions are prompt-injection surface —
  mitigated by the allowlist + selector validation + same-origin nav + rate cap.
  Flag for review before any expansion of the action set.
- **Context window growth**: large markdown source + long history → token blowup.
  MVP windowing + wholesale injection is fine for modest sources; revisit with
  RAG/chunking when the source grows.
- **CORS**: widget runs on arbitrary origins; backend must allowlist + handle
  OPTIONS preflight correctly.
- **Provider tool-calling variance**: action format is text-based to stay
  provider-agnostic; revisit tool-calling per provider later.
- **Multi-tab**: history syncs via `storage` event, but only one tab owns the
  live push channel (acceptable for MVP).
