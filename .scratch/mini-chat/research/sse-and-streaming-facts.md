# Research: SSE & streaming facts

For ticket [01](../issues/01-sse-and-streaming-facts.md). Feeds ticket 05 (SSE
lifecycle). All claims cited to primary sources.

## EventSource (browser) — capabilities & limits

- **GET-only, no request body, no custom headers.** EventSource can only open a
  `GET` stream; you cannot set arbitrary request headers (only the "simple"
  headers). So any auth/identity must travel as a **query param** or a **cookie**,
  not a header. [MDN: EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource);
  [@microsoft/fetch-event-source write-up of EventSource limitations](https://medium.com/pon-tech-talk/extend-the-usage-of-the-eventsource-api-with-microsoft-fetch-event-source-a5c83ff95964);
  [cross-domain SSE troubleshooting](https://dev.to/mechcloud_academy/how-to-troubleshoot-a-cross-domain-server-sent-events-connection-526m).
  - ⇒ `PLAN.md`'s `GET /api/sse?sessionId=X` is the right shape; you **cannot**
    later bolt on an `Authorization:` header without abandoning native
    EventSource (you'd need `fetch` + `ReadableStream`, or
    `@microsoft/fetch-event-source`).
- **Credentials.** `new EventSource(url, { withCredentials: true })` sends CORS
  credentials (cookies). Default `false`. For a credentialed cross-origin stream
  the server must respond with `Access-Control-Allow-Credentials: true` **and** a
  specific `Access-Control-Allow-Origin` (never `*`).
  [MDN: EventSource.withCredentials](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials).
- **Auto-reconnect + `retry:`.** On drop the browser reconnects automatically
  after a delay. A `retry: <ms>` field recommends the delay (default ≈ 3000 ms);
  it **cannot** be set from JavaScript.
  [WHATWG HTML §9.2](https://html.spec.whatwg.org/dev/server-sent-events.html);
  [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server_sent_events);
  [javascript.info: SSE](https://javascript.info/server-sent-events).
- **`Last-Event-ID` resumability.** When the server tags events with an `id:`
  field, the browser remembers the last one and resends it as the
  `Last-Event-ID` request header on reconnect — enabling server-side replay.
  Without `id:`, reconnect replays nothing.
  [WHATWG §9.2](https://html.spec.whatwg.org/dev/server-sent-events.html).
- **Retry control is limited.** The browser retries "a few times then stops" with
  no app-level strategy via native EventSource (hence libraries like
  fetch-event-source exist). [fetch-event-source write-up, ibid.]
- **Comment-line keepalive.** Lines beginning with `:` are ignored by the client
  but keep the TCP/SSE connection alive — the standard pattern to defeat
  intermediary (proxy/CDN/load-balancer) idle timeouts. Dispatching an event
  requires a **blank line**; consecutive `data:` lines concatenate with `\n`.
  [MDN: Using server-sent events, ibid.]

## OpenAI-compatible streaming wire format (upstream)

The backend proxy consumes this from the provider and re-emits its own `ServerEvent`
SSE to the browser — i.e. the backend is an **SSE translator**.

- Request: `POST /v1/chat/completions` with `stream: true`.
  [OpenAI Cookbook: How to stream completions](https://cookbook.openai.com/examples/how_to_stream_completions).
- Each streamed event is `data: {json}\n\n`; the JSON carries
  `choices[0].delta` with partial **`content`** (and `role` on the first chunk).
  [OpenAI API reference: streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).
- **Terminal sentinel:** a final `data: [DONE]\n\n`.
  [OpenAI API reference: create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- Optional final usage chunk before `[DONE]` via
  `stream_options: { include_usage: true }` (ibid.).
- Minor: recent OpenAI "stream obfuscation" adds noise fields to normalize payload
  size; disable with `include_obfuscation: false` if bandwidth matters
  (OpenRouter/Groq may not emit these). (ibid.)

## Implications for Mini-Chat (inputs to ticket 05)

1. Browser→server uses native EventSource over GET — keep `?sessionId=` query
   param. **No header-based auth is possible** without leaving native EventSource.
2. Therefore CORS origin-allowlist is the **only native** transport-level gate;
   stronger abuse protection (ticket 03) must live in the request body / a
   query-param token / a cookie / server-side rate limiting.
3. Auto-reconnect is free; `Last-Event-ID` resumability is available **but only
   pays off if the server assigns event ids and buffers a replay window** — likely
   over-engineering for an MVP whose server is stateless on history. Decision for
   ticket 05.
4. Server keepalive pings (comment lines) are needed for robustness behind
   proxies/CDNs — schedule them in the server.
5. Backend implementation = read upstream `data:` lines, push `delta.content` as
   `token` ServerEvents, emit `done` at `[DONE]`. Straightforward translation.
