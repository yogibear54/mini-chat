import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMiniChatServer } from "./index";
import type { ChatProvider } from "./providers/types";
import type { PageContext } from "@shared/types";

// Seam 6 (agreed): backend HTTP integration with the fake provider —
// SSE connect, chat → tokens stream + done, CORS, fan-out, abuse gates.
// PLAN.md §3.2 / §3.2.1 / §3.2.2.

const ORIGIN = "http://test.local";

let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const srv = await createMiniChatServer({
    port: 0,
    allowedOrigins: [ORIGIN],
    providerName: "fake",
    rateLimitPerIpPerMin: 2,
    budgetCapDailyUsd: 5,
    pricePerMTok: 1,
    llmLogPath: null, llmLogEnabled: false, // never pollute the real traffic log
  });
  base = `http://127.0.0.1:${srv.port}`;
  close = srv.close;
});

afterAll(async () => {
  await close();
});

const ctx: PageContext = {
  url: "https://test.local/",
  title: "T",
  path: "/",
  sections: [{ id: "pricing", label: "Pricing" }],
  currentSectionId: "pricing",
};

async function postChatWith(sessionId: string, urlBase: string, userText: string) {
  return fetch(`${urlBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ sessionId, agentId: "default", history: [{ role: "user", content: userText }], pageContext: ctx }),
  });
}

async function postChat(sessionId: string, origin = ORIGIN, urlBase = base) {
  return fetch(`${urlBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ sessionId, agentId: "default", history: [{ role: "user", content: "plans?" }], pageContext: ctx }),
  });
}

/** Read one SSE connection until it collects `done`, or the stream stalls. */
async function readUntilDone(res: Response, timeoutMs = 3_000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Record<string, unknown>[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined as never })),
    ]);
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const data = raw.split("\n").find((l) => l.startsWith("data:"));
      if (data) {
        const ev = JSON.parse(data.slice(5));
        events.push(ev);
        if (ev.type === "done") return { events, cancel: () => reader.cancel() };
      }
    }
  }
  throw new Error("timed out waiting for done: " + JSON.stringify(events));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("SSE + chat happy path", () => {
  it("streams tokens then done, in order, with a requestId", async () => {
    const sse = await fetch(`${base}/api/sse?sessionId=t1`, { headers: { Origin: ORIGIN } });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");

    const chat = await postChat("t1");
    expect(chat.status).toBe(202);

    const { events, cancel } = await readUntilDone(sse);
    await cancel();
    const tokens = events.filter((e) => e.type === "token") as { value: string }[];
    const dones = events.filter((e) => e.type === "done") as { requestId: string }[];
    expect(tokens.length).toBeGreaterThan(3);
    expect(tokens.map((t) => t.value).join("")).toMatch(/Growth/);
    expect(dones).toHaveLength(1);
    expect(typeof dones[0].requestId).toBe("string");
  });

  it("fans out: a second tab on the same session also receives the turn", async () => {
    const sse1 = await fetch(`${base}/api/sse?sessionId=t2`, { headers: { Origin: ORIGIN } });
    const sse2 = await fetch(`${base}/api/sse?sessionId=t2`, { headers: { Origin: ORIGIN } });
    await postChat("t2");
    const [r1, r2] = await Promise.all([readUntilDone(sse1), readUntilDone(sse2)]);
    await r1.cancel();
    await r2.cancel();
    expect(r1.events.some((e) => e.type === "done")).toBe(true);
    expect(r2.events.some((e) => e.type === "done")).toBe(true);
  });

  it("serves greeting config without an LLM call", async () => {
    const res = await fetch(`${base}/api/config`, { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as { greetingText: string };
    expect(typeof cfg.greetingText).toBe("string");
    expect(cfg.greetingText.length).toBeGreaterThan(0);
  });
});

describe("LLM traffic log (jsonl)", () => {
  it("records the request payload and the completed response for a turn", async () => {
    const { dir, path } = { dir: mkdtempSync(join(tmpdir(), "mc-llmlog-")), path: join(mkdtempSync(join(tmpdir(), "mc-llmlog-")), "llm.jsonl") };
    const srv = await createMiniChatServer({
      port: 0,
      allowedOrigins: [ORIGIN],
      providerName: "fake",
      rateLimitPerIpPerMin: 30,
      budgetCapDailyUsd: 5,
      pricePerMTok: 1,
      llmLogPath: path,
    });
    const b = `http://127.0.0.1:${srv.port}`;
    const sse = await fetch(`${b}/api/sse?sessionId=log1`, { headers: { Origin: ORIGIN } });
    await postChat("log1", ORIGIN, b);
    const r = await readUntilDone(sse);
    await r.cancel();

    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    const req = lines[0];
    expect(req.type).toBe("request");
    expect(req.sessionId).toBe("log1");
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[0].content).toContain("json-action"); // action vocabulary
    expect(req.messages.at(-1)).toEqual({ role: "user", content: "plans?" });
    expect(req.pageContext.sections[0].id).toBe("pricing");
    expect(typeof req.ts).toBe("string");
    const res = lines[1];
    expect(res.type).toBe("response");
    expect(res.status).toBe("done");
    expect(res.text).toContain("Growth"); // the fake provider's scripted reply
    expect(res.usage?.completionTokens).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.requestId).toBe(req.requestId); // correlated
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("narration retry (reliability net)", () => {
  it("re-asks with forced tool choice when the model narrates without calling", async () => {
    // first stream: narration only; second (forced): the tool call
    let call = 0;
    const scripted: ChatProvider = {
      async *stream(req) {
        call++;
        if (req.toolChoice === "required") {
          yield { type: "toolCall", id: "c2", name: "highlight", arguments: { selector: "#starter" } };
        } else {
          yield { type: "token", value: "Highlighting the Starter plan for you." };
        }
      },
    };
    const srv = await createMiniChatServer({
      port: 0, allowedOrigins: [ORIGIN], provider: scripted,
      rateLimitPerIpPerMin: 30, budgetCapDailyUsd: 5, pricePerMTok: 1,
      toolsMode: "auto", llmLogPath: null, llmLogEnabled: false,
    });
    const b = `http://127.0.0.1:${srv.port}`;
    const sse = await fetch(`${b}/api/sse?sessionId=nar1`, { headers: { Origin: ORIGIN } });
    await postChat("nar1", ORIGIN, b);
    const r = await readUntilDone(sse);
    await r.cancel();
    const streamed = r.events.filter((e) => e.type === "token").map((e: any) => e.value).join("");
    expect(call).toBe(2); // narration + forced retry
    expect(streamed).toContain("Highlighting the Starter plan"); // narration kept
    expect(streamed).toContain("json-action"); // retry fence appended
    expect(streamed).toContain('"#starter"');
    await srv.close();
  });

  it("retries when the model CLAIMS the action already happened (user asked)", async () => {
    let call = 0;
    const scripted: ChatProvider = {
      async *stream(req) {
        call++;
        if (req.toolChoice === "required") {
          yield { type: "toolCall", id: "c3", name: "highlight", arguments: { selector: "#growth" } };
        } else {
          yield { type: "token", value: "Just flagged it above — still on the Growth plan." };
        }
      },
    };
    const srv = await createMiniChatServer({
      port: 0, allowedOrigins: [ORIGIN], provider: scripted,
      rateLimitPerIpPerMin: 30, budgetCapDailyUsd: 5, pricePerMTok: 1,
      toolsMode: "auto", llmLogPath: null, llmLogEnabled: false,
    });
    const b = `http://127.0.0.1:${srv.port}`;
    const sse = await fetch(`${b}/api/sse?sessionId=nar3`, { headers: { Origin: ORIGIN } });
    // user asks for an action; reply claims it happened (no narration verbs)
    await fetch(`${b}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ sessionId: "nar3", agentId: "d", history: [{ role: "user", content: "highlight the growth plan" }], pageContext: ctx }),
    });
    const r = await readUntilDone(sse);
    await r.cancel();
    const streamed = r.events.filter((e) => e.type === "token").map((e: any) => e.value).join("");
    expect(call).toBe(2);
    expect(streamed).toContain("json-action");
    expect(streamed).toContain('"#growth"');
    await srv.close();
  });

  it("does NOT retry for plain Q&A (no action requested)", async () => {
    let call = 0;
    const scripted: ChatProvider = {
      async *stream() {
        call++;
        yield { type: "token", value: "The Growth plan is $5/mo." };
      },
    };
    const srv = await createMiniChatServer({
      port: 0, allowedOrigins: [ORIGIN], provider: scripted,
      rateLimitPerIpPerMin: 30, budgetCapDailyUsd: 5, pricePerMTok: 1,
      toolsMode: "auto", llmLogPath: null, llmLogEnabled: false,
    });
    const b = `http://127.0.0.1:${srv.port}`;
    const sse = await fetch(`${b}/api/sse?sessionId=nar4`, { headers: { Origin: ORIGIN } });
    await postChatWith("nar4", b, "what is the best plan?");
    const r = await readUntilDone(sse);
    await r.cancel();
    expect(call).toBe(1); // no retry
    await srv.close();
  });

  it("does NOT retry when the model already called a tool", async () => {
    let call = 0;
    const scripted: ChatProvider = {
      async *stream(req) {
        call++;
        yield { type: "toolCall", id: "c1", name: "scroll_to", arguments: { sectionId: "pricing" } };
        yield { type: "token", value: "Scrolling to pricing." };
      },
    };
    const srv = await createMiniChatServer({
      port: 0, allowedOrigins: [ORIGIN], provider: scripted,
      rateLimitPerIpPerMin: 30, budgetCapDailyUsd: 5, pricePerMTok: 1,
      toolsMode: "auto", llmLogPath: null, llmLogEnabled: false,
    });
    const b = `http://127.0.0.1:${srv.port}`;
    const sse = await fetch(`${b}/api/sse?sessionId=nar2`, { headers: { Origin: ORIGIN } });
    await postChat("nar2", ORIGIN, b);
    const r = await readUntilDone(sse);
    await r.cancel();
    expect(call).toBe(1); // no retry needed
    await srv.close();
  });
});

describe("CORS + abuse gates (§3.2.1)", () => {
  it("OPTIONS preflight echoes an allowed origin", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("rejects POST from a disallowed origin with 403", async () => {
    const sse = await fetch(`${base}/api/sse?sessionId=t3`, { headers: { Origin: ORIGIN } });
    expect((await postChat("t3", "http://evil.example")).status).toBe(403);
    await sse.body?.cancel();
  });

  it("429s beyond the per-IP rate limit (2/min in this test)", async () => {
    const sse = await fetch(`${base}/api/sse?sessionId=t4`, { headers: { Origin: ORIGIN } });
    await postChat("t4"); // within budget: 1st
    const res = await postChat("t4"); // 2nd allowed, then over the line
    const over = await postChat("t4");
    expect([res.status, over.status]).toContain(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
    await sse.body?.cancel();
  });

  it("503s when the daily budget cap is exceeded", async () => {
    // separate server with a $0.00001 cap so the fake provider's usage trips it
    const tiny = await createMiniChatServer({
      port: 0,
      allowedOrigins: [ORIGIN],
      providerName: "fake",
      rateLimitPerIpPerMin: 30,
      budgetCapDailyUsd: 0.00001,
      pricePerMTok: 1,
    });
    const tinyBase = `http://127.0.0.1:${tiny.port}`;
    const sse = await fetch(`${tinyBase}/api/sse?sessionId=b1`, { headers: { Origin: ORIGIN } });
    const first = await postChat("b1", ORIGIN, tinyBase);
    expect(first.status).toBe(202);
    const r = await readUntilDone(sse); // wait for the turn (and its usage) to land
    await r.cancel();
    const sse2 = await fetch(`${tinyBase}/api/sse?sessionId=b2`, { headers: { Origin: ORIGIN } });
    const blocked = await postChat("b2", ORIGIN, tinyBase);
    expect(blocked.status).toBe(503);
    await sse2.body?.cancel();
    await tiny.close();
  });
});
