import type { ChatMessage, PageContext } from "@shared/types";

// Context assembly (PLAN.md §3.1 / §9.4): system prompt + markdown source of
// truth + action vocabulary + page context; history windowing.

const ACTION_VOCABULARY = `# Actions you can take

You may act on the page by emitting fenced code blocks tagged exactly \`json-action\`
(one JSON object per block, no prose inside). The format is always:

\`\`\`json-action
{"action":"scrollTo","sectionId":"pricing"}
\`\`\`

**Always wrap actions in a \`\`\`json-action fence. Never output action JSON bare
(as a raw line) — it will show up as text in the chat.**

Rules:

- **Check the page context first.** Only scroll/highlight/move to sections or
  elements that exist on the CURRENT page (they appear in the page context's
  section list). If the thing you want to show lives on a different page,
  emit a \`navigate\` action to that page instead — never scroll to a section
  that isn't listed.
- CSS selectors for ids must include the leading \`#\` (e.g. \`#growth\`).
- Prefer \`sectionId\` (from the page context) over raw selectors when one fits;
  selectors must match exactly one element. When the same thing appears in the
  section list twice (a container id like \`starter\` AND a heading id like
  \`mini-s-starter\`), target the **container id** — not the \`mini-s-*\` heading —
  so \`move\` lands beside the whole block, not on top of it.
- **If you say you're doing something, do it.** Saying you'll move, scroll,
  highlight or navigate without emitting the matching \`json-action\` block
  is **broken** — the visitor sees the words and nothing happens. **Always** emit
  the block in the same reply where you promise the action.

  Examples (right vs wrong):

  WRONG (visitor says "go stand next to Growth"; you reply with prose only):

      Sure — shifting over next to the Growth plan for you.

  RIGHT (same request — always include the block):

      Sure — shifting over next to the Growth plan for you.

      \`\`\`json-action
      {"action":"move","near":"growth"}
      \`\`\`

  If the user asks for a move / scroll / highlight / navigate and you don't emit
  the corresponding \`json-action\` block, the request is **silently lost** —
  the user will see your text but nothing will happen. That is a bug, not a
  feature. Always pair the action with the announcement.
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
