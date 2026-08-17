import type { ChatMessage } from "@shared/types";
import type { ChatProvider, ProviderChunk, ProviderRequest, ToolDefinition } from "./types";

// OpenAI-compatible provider (OpenAI, OpenRouter, Groq, …). Consumes the
// upstream SSE stream (`data: {…}` + `data: [DONE]`) and yields token chunks,
// reasoning chunks (log-only), and completed tool calls.
//
// Tool calling: `tools` on the request; streamed `delta.tool_calls` fragments
// are reassembled and yielded as complete `toolCall` chunks with PARSED
// arguments. If the provider rejects tools (HTTP 400 mentioning tools), the
// same request is retried without them and the failure is remembered for the
// life of this provider instance (auto-fallback to text-mode fences).

interface OAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** accumulated fragments of one streamed tool call */
interface PartialToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

export function createOpenAICompatible(cfg: OAIConfig): ChatProvider {
  // remember per-provider-instance: this endpoint doesn't do tools
  let toolsRejected = false;

  async function* stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const messages: ChatMessage[] = [{ role: "system", content: req.system }, ...req.history];
    const wantTools = !!req.tools && !toolsRejected;
    // QUIRK: some providers (minimax on OpenRouter, at least) silently DROP
    // tool calls when stream_options.include_usage is set. Never combine them;
    // the budget falls back to the chars/4 estimate (§3.2.1) when usage is absent.
    const forced = req.toolChoice === "required";
    let response = await request(messages, signal, {
      includeUsage: !wantTools,
      tools: wantTools ? req.tools : undefined,
      toolChoice: forced ? "required" : undefined,
    });

    if (response.status === 400) {
      const bodyText = await response.clone().text().catch(() => "");
      if (forced) {
        // forced-choice unsupported here — surface it; do NOT flip
        // toolsRejected (normal auto calls may still work)
        const text = await response.text().catch(() => "");
        throw new Error(`provider HTTP 400 (tool_choice=required): ${text.slice(0, 200)}`);
      }
      if (wantTools && /tool/i.test(bodyText)) {
        // endpoint rejects tools — retry once without tools AND without
        // stream_options (a bare request), and never try tools again
        toolsRejected = true;
        response = await request(messages, signal, { includeUsage: false, tools: undefined });
      } else {
        // some strict providers reject stream_options — retry once without it
        response = await request(messages, signal, { includeUsage: false, tools: wantTools ? req.tools : undefined });
      }
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`provider HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    yield* parseSSE(response.body);
  }

  async function request(
    messages: ChatMessage[],
    signal: AbortSignal,
    opts: { includeUsage: boolean; tools?: ToolDefinition[]; toolChoice?: "required" },
  ) {
    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        ...(opts.includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" } : {}),
      }),
    });
  }

  async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // tool calls stream as fragments keyed by delta index
    const partials = new Map<number, PartialToolCall>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // comments/keepalives/ids ignored
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          // flush any completed tool calls before ending
          for (const call of flushToolCalls(partials)) yield call;
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const d = parsed.choices?.[0]?.delta;
          const delta = d?.content;
          if (typeof delta === "string" && delta) yield { type: "token", value: delta };
          // reasoning models (minimax-m3, deepseek-r1, …) stream their thinking
          // in delta.reasoning / delta.reasoning_content — capture it for the
          // traffic log instead of silently dropping it.
          const reasoning = d?.reasoning ?? d?.reasoning_content;
          if (typeof reasoning === "string" && reasoning) {
            yield { type: "reasoning", value: reasoning };
          }
          // tool-call fragments: accumulate by index, yield when arguments close
          if (Array.isArray(d?.tool_calls)) {
            for (const tc of d.tool_calls) {
              const idx = typeof tc.index === "number" ? tc.index : 0;
              const p = partials.get(idx) ?? { arguments: "" };
              if (tc.id) p.id = tc.id;
              if (tc.function?.name) p.name = tc.function.name;
              if (typeof tc.function?.arguments === "string") p.arguments += tc.function.arguments;
              partials.set(idx, p);
              if (isClosedJson(p.arguments)) {
                const call = finalize(p);
                if (call) yield call;
                partials.delete(idx);
              }
            }
          }
          if (parsed.usage) {
            yield {
              type: "usage",
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
            };
          }
        } catch {
          /* skip malformed upstream line */
        }
      }
    }
    // stream ended without [DONE] — flush anyway
    for (const call of flushToolCalls(partials)) yield call;
  }

  function finalize(p: PartialToolCall): ProviderChunk | null {
    try {
      return { type: "toolCall", id: p.id, name: p.name, arguments: JSON.parse(p.arguments || "{}") };
    } catch {
      return null; // malformed arguments — drop this call
    }
  }

  /** any still-pending (never-closed) fragments that parse cleanly */
  function* flushToolCalls(partials: Map<number, PartialToolCall>): Generator<ProviderChunk> {
    for (const [idx, p] of partials) {
      const call = finalize(p);
      if (call) yield call;
      partials.delete(idx);
    }
  }

  return { stream };
}

/** Heuristic: does this partial JSON string look like a complete value?
 *  Cheap brace/quote-aware scan — avoids yielding on half-streamed args. */
function isClosedJson(s: string): boolean {
  if (!s) return false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth === 0 && !inStr;
}
