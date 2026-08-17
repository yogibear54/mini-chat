import type { ChatMessage } from "@shared/types";

// Provider abstraction (PLAN.md §3.1). Add a provider = implement ChatProvider
// + register it in registry.ts.

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON schema
  };
}

export interface ProviderRequest {
  system: string;
  history: ChatMessage[];
  /** when set, the provider should use native tool calling */
  tools?: ToolDefinition[];
  /** force tool use on providers that support it (used by the narration retry) */
  toolChoice?: "auto" | "required";
}

export type ProviderChunk =
  | { type: "token"; value: string }
  | { type: "reasoning"; value: string }
  | { type: "toolCall"; id?: string; name?: string; arguments: Record<string, unknown> }
  | { type: "usage"; promptTokens?: number; completionTokens?: number };

export interface ChatProvider {
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
