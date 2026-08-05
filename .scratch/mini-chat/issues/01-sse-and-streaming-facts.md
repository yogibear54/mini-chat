# SSE & streaming facts

Type: research
Status: resolved

## Question

Gather the primary-source facts needed to decide Mini-Chat's SSE lifecycle
(ticket 05) and the provider streaming path. Specifically:

- **EventSource API capabilities & limits** — can it send custom headers or
  credentials? Does it auto-reconnect, and using what mechanism (`Last-Event-ID`?
  the `retry:` field?)? What can't it do that `fetch`+ReadableStream can?
- **Idle-connection dropping** by intermediaries (proxies/CDNs/load balancers)
  and the standard keepalive pattern (comment-line `:\n\n` pings).
- **The OpenAI-compatible streaming wire format** over SSE — chunk shape
  (`data: {...}`), the `[DONE]` sentinel, delta-vs-full `content`, as used by
  OpenAI / OpenRouter / Groq.
- **EventSource & CORS** — does it send an `Origin` header? credentialed mode?
  any same-origin restrictions?

Cite primary sources (MDN `EventSource`, the WHATWG HTML spec section on server-sent
events, OpenAI/OpenRouter API docs). Write findings to
`.scratch/mini-chat/research/sse-and-streaming-facts.md`.

Feeds: ticket 05 (SSE lifecycle), and informs the provider implementation.

## Answer

Findings in [research/sse-and-streaming-facts.md](../research/sse-and-streaming-facts.md) (primary-source cited). Headlines:

- **EventSource is GET-only: no request body, no custom headers** — auth/identity must be a query param (`?sessionId=`) or a cookie, never a header. Switching to header-based auth would require abandoning native EventSource.
- CORS origin-allowlist is the **only native** transport gate; stronger abuse protection (ticket 03) must live elsewhere (body token / cookie / server-side rate limiting).
- **Auto-reconnect + `retry:` are free**; `Last-Event-ID` resumability only pays off if the server assigns event ids and buffers a replay window — likely over-engineering for the stateless MVP server.
- **Comment-line keepalive pings are needed** behind proxies/CDNs.
- Upstream OpenAI-compatible streaming = `data: {…}\n\n` chunks with `choices[0].delta.content`, terminated by `data: [DONE]`; the backend translates these into its `token` / `done` ServerEvents.

Unblocks ticket 05.
