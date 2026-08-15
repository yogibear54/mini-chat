import type { ChatProvider } from "./types";

// Fake provider — deterministic, offline. Used by tests and the demo
// (PROVIDER=fake). Streams a scripted reply including an action fence.

export function createFakeProvider(script?: string): ChatProvider {
  const defaultScript = [
    "Sure! Here's the gist:\n\n",
    "We have three plans, and the **Growth** plan is the popular one.\n\n",
    "```json-action\n{\"action\":\"scrollTo\",\"sectionId\":\"pricing\"}\n```\n",
    "Let me take you to the pricing section.",
  ].join("");
  const text = script ?? defaultScript;

  async function* stream(): AsyncIterable<{ type: "token"; value: string } | { type: "usage"; promptTokens: number; completionTokens: number }> {
    for (const chunk of text.match(/[\s\S]{1,12}/g) ?? []) {
      await sleep(10);
      yield { type: "token", value: chunk };
    }
    yield { type: "usage", promptTokens: 40, completionTokens: 40 };
  }

  return { stream: (_req, _signal) => stream() };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
