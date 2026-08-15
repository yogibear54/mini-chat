import type { ChatMessage } from "@shared/types";
import type { ChatProvider, ProviderChunk, ProviderRequest } from "./types";

// OpenAI-compatible provider (OpenAI, OpenRouter, Groq, …). Consumes the
// upstream SSE stream (`data: {…}` + `data: [DONE]`) and yields token chunks.

interface OAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function createOpenAICompatible(cfg: OAIConfig): ChatProvider {
  async function* stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const messages: ChatMessage[] = [{ role: "system", content: req.system }, ...req.history];
    let response = await request(messages, signal, true);
    if (response.status === 400) {
      // some strict providers reject stream_options — retry once without it
      response = await request(messages, signal, false);
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`provider HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    yield* parseSSE(response.body);
  }

  async function request(messages: ChatMessage[], signal: AbortSignal, includeUsage: boolean) {
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
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      }),
    });
  }

  async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<ProviderChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
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
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield { type: "token", value: delta };
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
  }

  return { stream };
}
