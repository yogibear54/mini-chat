import { describe, it, expect } from "vitest";
import { assembleSystemMessage, windowHistory } from "./context";
import type { ChatMessage, PageContext } from "@shared/types";

// Seam 4 (agreed): server context assembly — system prompt + source.md +
// action vocabulary + pageContext; history windowing. PLAN.md §3.1/§9.4.

const ctx: PageContext = {
  url: "https://example.com/pricing",
  title: "Pricing — Example",
  path: "/pricing",
  metaDescription: "Plans and costs",
  sections: [
    { id: "hero", label: "Welcome" },
    { id: "pricing", label: "Pricing" },
  ],
  currentSectionId: "pricing",
};

describe("assembleSystemMessage", () => {
  const sys = assembleSystemMessage({
    systemPrompt: "You are the Example site assistant.",
    sourceMarkdown: "# Example knowledge\n\nWe charge $5/mo.",
    pageContext: ctx,
  });

  it("starts with the configured system prompt", () => {
    expect(sys.startsWith("You are the Example site assistant.")).toBe(true);
  });

  it("injects the markdown source of truth wholesale", () => {
    expect(sys).toContain("# Example knowledge");
    expect(sys).toContain("We charge $5/mo.");
  });

  it("documents the action vocabulary and the json-action fence rules", () => {
    expect(sys).toContain("json-action");
    expect(sys).toContain("scrollTo");
    expect(sys).toContain("highlight");
    expect(sys).toContain("navigate");
    expect(sys).toContain("move");
    expect(sys).toContain("same-origin");
  });

  it("injects page context: url, title, meta, sections, current section", () => {
    expect(sys).toContain("https://example.com/pricing");
    expect(sys).toContain("Pricing — Example");
    expect(sys).toContain("Plans and costs");
    expect(sys).toContain("hero — Welcome");
    expect(sys).toContain("pricing — Pricing");
    expect(sys).toContain("current section"); // and marks the current one
  });
});

describe("windowHistory", () => {
  const mk = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `message ${i}`,
    }));

  it("keeps the newest messages within the cap", () => {
    const out = windowHistory(mk(50), 10);
    expect(out).toHaveLength(10);
    expect(out[0].content).toBe("message 40");
    expect(out[9].content).toBe("message 49");
  });

  it("passes short histories through unchanged", () => {
    const h = mk(3);
    expect(windowHistory(h, 40)).toEqual(h);
  });

  it("truncates oversized individual messages defensively", () => {
    const out = windowHistory([{ role: "user", content: "x".repeat(50_000) }], 40);
    expect(out[0].content.length).toBe(16_000);
  });
});
