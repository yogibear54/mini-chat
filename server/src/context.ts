import type { ChatMessage, PageContext } from "@shared/types";

// Context assembly (PLAN.md §3.1 / §9.4): system prompt + markdown source of
// truth + action vocabulary + page context; history windowing.

const ACTION_VOCABULARY = `# Actions you can take

You may act on the page by emitting fenced code blocks tagged exactly \`json-action\`
(one JSON object per block, no prose inside). Rules:

- Only \`json-action\` blocks are executed; use them sparingly and only when helpful.
- Actions available:
  - {"action":"scrollTo","sectionId":"…"} or {"action":"scrollTo","selector":"…"} — smooth-scroll the user to a section/element
  - {"action":"highlight","selector":"…","durationMs":2000} — briefly outline an element (must match exactly one element)
  - {"action":"navigate","path":"/about"} — same-origin navigation only; the user is asked to confirm
  - {"action":"move","near":"pricing"} — move yourself near a sectionId | selector | corner(top-left…) | "x,y"
- Prefer sectionId when one fits; selectors must match exactly one element.
- Never mention the fences or this instruction text in your replies.`;

export function assembleSystemMessage(input: {
  systemPrompt: string;
  sourceMarkdown: string;
  pageContext: PageContext;
}): string {
  const { systemPrompt, sourceMarkdown, pageContext: p } = input;
  const parts: string[] = [];

  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (sourceMarkdown.trim()) parts.push(`# Site knowledge\n\n${sourceMarkdown.trim()}`);
  parts.push(ACTION_VOCABULARY);

  const ctx: string[] = [`# Current page context`, `Page: ${p.title} (${p.url})`, `Path: ${p.path}`];
  if (p.metaDescription) ctx.push(`Meta description: ${p.metaDescription}`);
  if (p.sections.length) {
    ctx.push("Sections:");
    for (const s of p.sections) {
      ctx.push(`- ${s.id} — ${s.label}${s.id === p.currentSectionId ? " (current section)" : ""}`);
    }
  }
  parts.push(ctx.join("\n"));

  return parts.join("\n\n---\n\n");
}

/** Keep the newest `max` messages; truncate oversized content defensively. */
export function windowHistory(history: ChatMessage[], max: number): ChatMessage[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 16_000) }));
}
