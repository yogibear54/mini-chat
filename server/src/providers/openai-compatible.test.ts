import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { createOpenAICompatible } from "./openai-compatible";

// Tool-calling provider tests against a real local SSE server shaped like
// OpenAI/OpenRouter streaming responses.

let base: string;
let close: () => Promise<void>;
/** script of SSE `data:` payloads the fake upstream will emit */
let script: string[] = [];
let lastRequestBody: any;

beforeAll(async () => {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      lastRequestBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const payload of script) res.write(payload);
      res.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  close = () => new Promise((done) => srv.close(() => done(undefined)));
});
afterAll(async () => { await close(); });

const provider = () =>
  createOpenAICompatible({ baseUrl: base, apiKey: "test", model: "test-model" });

async function collect(gen: AsyncIterable<{ type: string; [k: string]: unknown }>) {
  const out: { type: string; [k: string]: unknown }[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("tools: request shape", () => {
  it("sends the tool definitions when tools are enabled", async () => {
    script = [sse({ choices: [{ delta: {} }] }), "data: [DONE]\n\n"];
    const tools = [
      { type: "function" as const, function: { name: "scrollTo", description: "scroll", parameters: { type: "object", properties: {} } } },
    ];
    await collect(provider().stream({ system: "s", history: [], tools }, new AbortController().signal));
    expect(Array.isArray(lastRequestBody.tools)).toBe(true);
    expect(lastRequestBody.tools[0].function.name).toBe("scrollTo");
    expect(lastRequestBody.tool_choice).toBe("auto");
  });

  it("omits tools entirely when none are passed", async () => {
    script = [sse({ choices: [{ delta: {} }] }), "data: [DONE]\n\n"];
    await collect(provider().stream({ system: "s", history: [] }, new AbortController().signal));
    expect(lastRequestBody.tools).toBeUndefined();
  });
});

describe("tools: streamed tool_calls assembly", () => {
  it("reassembles fragmented arguments into complete tool calls", async () => {
    script = [
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "scrollTo", arguments: "" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"sec' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tionId":"pricing"}' } }] } }] }),
      sse({ choices: [{ delta: { content: "Taking you there." } }] }),
      sse({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      "data: [DONE]\n\n",
    ];
    const chunks = await collect(provider().stream({ system: "s", history: [] }, new AbortController().signal));
    const call = chunks.find((c) => c.type === "toolCall");
    expect(call).toBeDefined();
    expect((call as any).name).toBe("scrollTo");
    expect((call as any).arguments).toEqual({ sectionId: "pricing" }); // parsed JSON
    expect(chunks.some((c) => c.type === "token")).toBe(true); // prose still streams
    expect(chunks.some((c) => c.type === "usage")).toBe(true);
  });

  it("ignores malformed tool-call argument JSON (yields nothing for that call)", async () => {
    script = [
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "move", arguments: "{not json" } }] } }] }),
      "data: [DONE]\n\n",
    ];
    const chunks = await collect(provider().stream({ system: "s", history: [] }, new AbortController().signal));
    expect(chunks.filter((c) => c.type === "toolCall")).toHaveLength(0);
  });
});

describe("fallback when the provider rejects tools", () => {
  it("retries the same request without tools and remembers the failure", async () => {
    let n = 0;
    // swap in a server that 400s the first (tools) request, 200s the retry
    const srv2 = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        n++;
        if (parsed.tools && n === 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "tools not supported" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(sse({ choices: [{ delta: { content: "ok" } }] }));
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise<void>((r) => srv2.listen(0, r));
    const addr = srv2.address() as { port: number };
    const p = createOpenAICompatible({ baseUrl: `http://127.0.0.1:${addr.port}`, apiKey: "t", model: "m" });
    const tools = [{ type: "function" as const, function: { name: "f", description: "", parameters: { type: "object", properties: {} } } }];
    const chunks = await collect(p.stream({ system: "s", history: [], tools }, new AbortController().signal));
    expect(chunks.some((c) => c.type === "token")).toBe(true); // retry succeeded
    // second call with tools: remembered — must not include tools again
    await collect(p.stream({ system: "s", history: [], tools }, new AbortController().signal));
    expect(n).toBe(3); // [tools 400] + [retry ok] + [no-tools ok] — never tools again
    await new Promise((d) => srv2.close(() => d(undefined)));
  });
});
