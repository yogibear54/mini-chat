import type { ChatProvider } from "./types";
import { createOpenAICompatible } from "./openai-compatible";
import { createFakeProvider } from "./fake";

// Provider registry — the extensibility point (PLAN.md §3.1, README "add a provider").

type Factory = (cfg: Record<string, unknown>) => ChatProvider;

const registry = new Map<string, Factory>([
  ["openai-compatible", (cfg) => createOpenAICompatible(cfg as never)],
  ["fake", () => createFakeProvider()],
]);

export function registerProvider(name: string, factory: Factory): void {
  registry.set(name, factory);
}

export function createProvider(name: string, cfg: Record<string, unknown>): ChatProvider {
  const key = name.trim().toLowerCase();
  const factory = registry.get(key);
  if (!factory) {
    throw new Error(
      `unknown provider "${name}" (PROVIDER env) — valid: "openai-compatible" ` +
        `(covers OpenAI / OpenRouter / Groq / any OpenAI-style API — set the service via LLM_BASE_URL) ` +
        `or "fake" (offline demo)`,
    );
  }
  return factory(cfg);
}
