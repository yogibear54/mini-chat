import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { ChatRequest, ServerEvent } from "@shared/types";
import { loadConfig, type Config } from "./config";
import { createProvider } from "./providers/registry";
import type { ChatProvider } from "./providers/types";
import { assembleSystemMessage, windowHistory } from "./context";
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

    try {
      const system = assembleSystemMessage({
        systemPrompt,
        sourceMarkdown,
        pageContext: chatReq.pageContext,
      });
      let sawUsage = false;
      let streamedChars = 0;
      for await (const chunk of provider.stream(
        { system, history: windowHistory(chatReq.history, maxHistory) },
        controller.signal,
      )) {
        if (chunk.type === "token") {
          streamedChars += chunk.value.length;
          sessions.fanout(chatReq.sessionId, { type: "token", value: chunk.value });
        } else {
          sawUsage = true; // real spend beats the estimate (§3.2.1)
          budget.recordUsage(chunk.promptTokens, chunk.completionTokens);
        }
      }
      if (!sawUsage) budget.recordEstimated("x".repeat(streamedChars)); // estimate only when absent
      sessions.fanout(chatReq.sessionId, { type: "done", requestId });
    } catch (err) {
      if (controller.signal.aborted) return; // last reader left — expected
      console.error("[mini-chat] provider error:", err);
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
    return serveFile(res, `../../demo/${pathname.replace(/^\/demo\//, "")}`, "text/html; charset=utf-8");
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
  createMiniChatServer().then(({ port }) => {
    console.log(`[mini-chat] backend listening on http://localhost:${port}`);
    console.log("[mini-chat] demo: http://localhost:8787/demo/index.html (run `npm run build` first)");
  });
}
