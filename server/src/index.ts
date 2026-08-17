import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { ChatRequest, ServerEvent } from "@shared/types";
import { loadConfig, type Config } from "./config";
import { createLlmLog, type LlmLog } from "./llm-log";
import { createProvider } from "./providers/registry";
import type { ChatProvider } from "./providers/types";
import { assembleSystemMessage, windowHistory, ACTION_TOOLS, toolCallToAction } from "./context";
import { createRateLimiter, createBudget } from "./ratelimit";
import { SessionRegistry, type Stream } from "./sessions";

// Backend proxy (PLAN.md §3.2): GET /api/sse (fan-out stream + keepalive),
// POST /api/chat (LLM turn streamed down the SSE channel), GET /api/config
// (greeting). CORS allowlist, per-IP rate limit, daily budget cap. The server
// never parses LLM content — it is a dumb token pass-through (§3.4).

const PING_INTERVAL_MS = 15_000;

export function createMiniChatServer(overrides: {
  port?: number;
  allowedOrigins?: string[];
  providerName?: string;
  provider?: ChatProvider;
  rateLimitPerIpPerMin?: number;
  budgetCapDailyUsd?: number;
  pricePerMTok?: number;
  greetingText?: string;
  maxHistoryMessages?: number;
  systemPrompt?: string;
  sourceMarkdown?: string;
  llmLogPath?: string | null;
  llmLogEnabled?: boolean;
  toolsMode?: "auto" | "on" | "off";
} = {}) {
  const config: Config = loadConfig();
  const allowedOrigins = overrides.allowedOrigins ?? config.allowedOrigins;
  const provider =
    overrides.provider ??
    createProvider(overrides.providerName ?? config.provider, {
      baseUrl: config.providerConfig.baseUrl,
      apiKey: config.providerConfig.apiKey,
      model: config.providerConfig.model,
    });
  const rateLimiter = createRateLimiter(overrides.rateLimitPerIpPerMin ?? config.rateLimitPerIpPerMin);
  const budget = createBudget(
    overrides.budgetCapDailyUsd ?? config.budgetCapDailyUsd,
    overrides.pricePerMTok ?? config.providerConfig.pricePerMTok,
  );
  const maxHistory = overrides.maxHistoryMessages ?? config.maxHistoryMessages;
  const systemPrompt = overrides.systemPrompt ?? config.systemPrompt;
  const sourceMarkdown = overrides.sourceMarkdown ?? config.sourceMarkdown;
  const greetingText = overrides.greetingText ?? config.greetingText;
  const llmLog: LlmLog = createLlmLog(
    overrides.llmLogPath !== undefined ? overrides.llmLogPath : config.llmLogPath,
    overrides.llmLogEnabled ?? config.llmLogEnabled,
  );

  // Native tool calling: auto (try, fall back to text fences), on, or off.
  const toolsMode = overrides.toolsMode ?? config.toolsMode;
  const useTools = toolsMode !== "off"; // "on" forces tools; provider falls back

  const sessions = new SessionRegistry();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (req.method === "OPTIONS") return handlePreflight(req, res);
      switch (url.pathname) {
        case "/api/sse":
          return handleSse(req, res, url);
        case "/api/chat":
          return await handleChat(req, res);
        case "/api/config":
          return handleConfig(req, res);
        case "/mini-chat.js":
          return serveFile(res, "../../client/dist/mini-chat.js", "application/javascript");
        default:
          if (url.pathname.startsWith("/demo/")) return serveDemo(res, url.pathname);
          res.writeHead(404, headers(req)).end("not found");
      }
    } catch (err) {
      console.error("[mini-chat] request error:", err);
      if (!res.headersSent) res.writeHead(500, headers(req)).end("internal error");
    }
  });

  // ── CORS (§3.2.1) ────────────────────────────────────────────────────────

  function originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // same-origin / curl
    return allowedOrigins.includes(origin);
  }

  function headers(req: IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    return {
      ...(origin && allowedOrigins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
      "Cache-Control": "no-store",
    };
  }

  function handlePreflight(req: IncomingMessage, res: ServerResponse) {
    if (!originAllowed(req)) return res.writeHead(403).end();
    res.writeHead(204, {
      ...headers(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
  }

  // ── GET /api/sse — fan-out stream + keepalive (§3.2.2) ────────────────────

  function handleSse(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!originAllowed(req)) return res.writeHead(403).end();
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) return res.writeHead(400, headers(req)).end("sessionId required");

    res.writeHead(200, {
      ...headers(req),
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n"); // reconnect hint (§3.2.2)

    const stream: Stream = {
      send(event: ServerEvent) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    sessions.addStream(sessionId, stream);

    const ping = setInterval(() => res.write(": ping\n\n"), PING_INTERVAL_MS);
    ping.unref?.();
    req.on("close", () => {
      clearInterval(ping);
      sessions.removeStream(sessionId, stream);
    });
  }

  // ── POST /api/chat — run a turn, stream it to every open stream ──────────

  async function handleChat(req: IncomingMessage, res: ServerResponse) {
    const h = headers(req);
    if (!originAllowed(req)) return res.writeHead(403, h).end();

    const ip = clientIp(req);
    if (!rateLimiter.check(ip)) {
      return res.writeHead(429, { ...h, "Retry-After": "60" }).end("rate limited");
    }
    if (budget.exceeded()) {
      return res.writeHead(503, h).end("daily budget cap exceeded");
    }

    const body = await readBody(req);
    const chatReq = parseChatRequest(body);
    if (!chatReq) return res.writeHead(400, h).end("invalid request");
    if (!sessions.hasStream(chatReq.sessionId)) {
      return res.writeHead(409, h).end("no open stream for sessionId");
    }

    res.writeHead(202, h).end();

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    sessions.trackTurn(chatReq.sessionId, controller);
    const startedAt = Date.now();
    let fullText = "";
    let fullReasoning = "";
    let streamedChars = 0;
    let sawUsage = false;
    let usage: { promptTokens?: number; completionTokens?: number } | undefined;

    try {
      const system = assembleSystemMessage({
        systemPrompt,
        sourceMarkdown,
        pageContext: chatReq.pageContext,
        tools: useTools,
      });
      const history = windowHistory(chatReq.history, maxHistory);
      llmLog.write({
        type: "request",
        sessionId: chatReq.sessionId,
        requestId,
        model: config.providerConfig.model,
        messages: [{ role: "system", content: system }, ...history],
        pageContext: chatReq.pageContext,
        ...(useTools ? { tools: "native" } : { tools: "text-fences" }),
      });
      let toolActions: { tool?: string; id?: string; action: Record<string, unknown> }[] = [];
      let holdOpen = false; // a think-tag split across token chunks
      const emitToolCall = (chunk: { id?: string; name?: string; arguments: Record<string, unknown> }) => {
        // Native tool call → translate to the client's fence format and
        // stream it as tokens (client scanner/executor unchanged).
        const action = toolCallToAction(chunk.name, chunk.arguments);
        if (!action) {
          console.warn("[mini-chat] unknown tool call ignored:", chunk.name);
          return;
        }
        const fence = `\n\n\`\`\`json-action\n${JSON.stringify(action)}\n\`\`\`\n`;
        streamedChars += fence.length;
        fullText += fence;
        toolActions.push({ tool: chunk.name, id: chunk.id, action });
        sessions.fanout(chatReq.sessionId, { type: "token", value: fence });
      };
      for await (const chunk of provider.stream(
        { system, history, tools: useTools ? ACTION_TOOLS : undefined },
        controller.signal,
      )) {
        if (chunk.type === "token") {
          let value = chunk.value;
          // reasoning models sometimes leak think-tags INTO content (not the
          // reasoning field) — strip any complete think-tag anywhere (incl.
          // namespaced tags like </mm:think>)
          value = value.replace(/<\/?[a-zA-Z0-9_:-]*think>/g, "");
          // tag split across chunks: if the previous chunk ended mid-tag, the
          // current chunk likely begins with the closing `>` — drop up to it
          if (holdOpen) {
            value = value.replace(/^[^<]*>/, "");
            holdOpen = false;
          }
          // if THIS chunk still ends mid-tag, remember it (so the next chunk
          // knows) and drop the partial so it doesn't leak into the chat
          if (/<[^>]*$/.test(value)) {
            holdOpen = true;
            value = value.replace(/<[^>]*$/, "");
          }
          if (!value) continue;
          streamedChars += value.length;
          fullText += value;
          sessions.fanout(chatReq.sessionId, { type: "token", value });
        } else if (chunk.type === "reasoning") {
          fullReasoning += chunk.value; // captured for the log only, never streamed
        } else if (chunk.type === "toolCall") {
          emitToolCall(chunk);
        } else if (chunk.type === "usage") {
          sawUsage = true; // real spend beats the estimate (§3.2.1)
          usage = { promptTokens: chunk.promptTokens, completionTokens: chunk.completionTokens };
          budget.recordUsage(chunk.promptTokens, chunk.completionTokens);
        }
      }
      // RELIABILITY NET: with tools active, models sometimes narrate an action
      // ("Highlighting the Starter plan for you.") or claim they already did it
      // ("Just flagged it above") without calling the tool — flaky backends plus
      // few-shot self-imitation from narrated history. Trigger on EITHER the
      // user's message requesting an action OR the reply narrating one; re-ask
      // ONCE with tool_choice forced and emit ONLY the resulting fence.
      const NARRATION_RE = /\b(?:scroll|highlight|navigat|mov|tak|head|bring|jump|show)\w*(?:\s+\w+){0,3}?\s+(?:you\s+)?(?:to|over|next|near|beside|under|down|up|there|the|this|that)\b/i;
      const USER_ACTION_RE = /\b(scroll|highlight|navigate|take me|bring me|go to|jump to|move|show me|point (?:at|to))\b/i;
      const lastUser = [...chatReq.history].reverse().find((m) => m.role === "user");
      const wantsAction = lastUser ? USER_ACTION_RE.test(lastUser.content) : false;
      if (useTools && toolActions.length === 0 && (wantsAction || NARRATION_RE.test(fullText)) && !controller.signal.aborted) {
        try {
          for await (const chunk of provider.stream(
            { system, history, tools: ACTION_TOOLS, toolChoice: "required" },
            controller.signal,
          )) {
            if (chunk.type === "toolCall") emitToolCall(chunk);
            // tokens/reasoning from the retry are intentionally discarded
          }
        } catch {
          /* best-effort: forced choice unsupported or second failure — give up silently */
        }
      }
      if (!sawUsage) budget.recordEstimated("x".repeat(streamedChars)); // estimate only when absent
      llmLog.write({
        type: "response",
        sessionId: chatReq.sessionId,
        requestId,
        model: config.providerConfig.model,
        status: "done",
        text: fullText,
        ...(fullReasoning ? { reasoning: fullReasoning } : {}),
        ...(toolActions.length ? { toolActions } : {}),
        usage: sawUsage ? usage : undefined,
        durationMs: Date.now() - startedAt,
      });
      // emit `done` once, after any narration retry — client finalizes the
      // synthetic fences the retry may have appended.
      sessions.fanout(chatReq.sessionId, { type: "done", requestId });
    } catch (err) {
      if (controller.signal.aborted) {
        // last reader left — expected; still record the partial turn
        llmLog.write({
          type: "response",
          sessionId: chatReq.sessionId,
          requestId,
          model: config.providerConfig.model,
          status: "aborted",
          ...(fullText ? { text: fullText } : {}),
          ...(fullReasoning ? { reasoning: fullReasoning } : {}),
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      console.error("[mini-chat] provider error:", err);
      llmLog.write({
        type: "response",
        sessionId: chatReq.sessionId,
        requestId,
        model: config.providerConfig.model,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
      sessions.fanout(chatReq.sessionId, { type: "error", message: "provider error" });
    } finally {
      sessions.untrackTurn(chatReq.sessionId, controller);
    }
  }

  // ── GET /api/config — client-rendered greeting source (§3.2.1) ───────────

  function handleConfig(req: IncomingMessage, res: ServerResponse) {
    if (!originAllowed(req)) return res.writeHead(403).end();
    res.writeHead(200, { ...headers(req), "Content-Type": "application/json" });
    res.end(JSON.stringify({ greetingText }));
  }

  // ── static: built widget + demo pages ────────────────────────────────────

  function serveFile(res: ServerResponse, rel: string, type: string) {
    const file = pathResolve(new URL(rel, import.meta.url).pathname);
    if (!existsSync(file)) {
      return res.writeHead(404).end("not built — run `npm run build` first");
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  }

  function serveDemo(res: ServerResponse, pathname: string) {
    const rel = pathname.replace(/^\/demo\//, "");
    if (!rel || rel.includes("..") || rel.includes("/")) {
      return res.writeHead(404).end(); // flat dir only — no traversal
    }
    const mime = rel.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
    return serveFile(res, `../../demo/${rel}`, mime);
  }

  // ── misc helpers ─────────────────────────────────────────────────────────

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody, reject) => {
      let size = 0;
      const parts: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 1_000_000) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        parts.push(c);
      });
      req.on("end", () => resolveBody(Buffer.concat(parts).toString("utf8")));
      req.on("error", reject);
    });
  }

  function parseChatRequest(body: string): ChatRequest | null {
    try {
      const v = JSON.parse(body) as ChatRequest;
      const ok =
        typeof v?.sessionId === "string" &&
        Array.isArray(v?.history) &&
        v.history.every((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string") &&
        typeof v?.pageContext === "object" && v.pageContext !== null;
      return ok ? v : null;
    } catch {
      return null;
    }
  }

  return new Promise<{ port: number; close: () => Promise<void> }>((resolveStart) => {
    server.on("error", (err) => {
      // fast tsx-watch restarts can race the old socket — retry instead of dying
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error("[mini-chat] port in use — retrying in 1s");
        setTimeout(() => {
          server.close();
          server.listen(overrides.port ?? config.port);
        }, 1_000);
      } else {
        throw err;
      }
    });
    server.listen(overrides.port ?? config.port, () => {
      const addr = server.address();
      resolveStart({
        port: typeof addr === "object" && addr ? addr.port : (overrides.port ?? config.port),
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

// Entry point: `npm run dev` / `npm start`
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  const cfg = loadConfig();
  createMiniChatServer().then(({ port }) => {
    console.log(`[mini-chat] backend listening on http://localhost:${port}`);
    console.log(
      `[mini-chat] provider=${cfg.provider} model=${cfg.providerConfig.model} ` +
        `base=${cfg.providerConfig.baseUrl}`,
    );
    if (cfg.llmLogEnabled) console.log(`[mini-chat] llm log: ${cfg.llmLogPath}`);
    console.log("[mini-chat] demo: http://localhost:8787/demo/index.html (run `npm run build` first)");
  });
}
