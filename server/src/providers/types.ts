import type { ChatMessage } from "@shared/types";

// Provider abstraction (PLAN.md §3.1). Add a provider = implement ChatProvider
// + register it in registry.ts.

export interface ProviderRequest {
  system: string;
  history: ChatMessage[];
}

export type ProviderChunk =
  | { type: "token"; value: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number };

export interface ChatProvider {
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
