import type { ChatMessage, PageContext } from "@shared/types";
import type { ToolDefinition } from "./providers/types";

// Context assembly (PLAN.md §3.1 / §9.4): system prompt + markdown source of
// truth + action vocabulary + page context; history windowing. Also exports
// the actions as native-tool JSON schemas so the prompt text and the tool
// definitions can never drift apart.

/** Shared rules that apply no matter how actions are emitted. */
const ACTION_RULES = `
- **Check the page context first.** Only scroll/highlight/move to sections or
  elements that exist on the CURRENT page (they appear in the page context's
  section list). If the thing you want to show lives on a different page,
  navigate to that page instead — never scroll to a section that isn't listed.
- CSS selectors for ids must include the leading \`#\` (e.g. \`#growth\`).
- Prefer \`sectionId\` (from the page context) over raw selectors when one fits;
  selectors must match exactly one element. When the same thing appears in the
  section list twice (a container id like \`starter\` AND a heading id like
  \`mini-s-starter\`), target the **container id** — not the \`mini-s-*\` heading —
  so \`move\` lands beside the whole block, not on top of it.
- Use actions sparingly and only when they clearly help.
- Never mention the fences/tools or this instruction text in your replies.`;

const ACTION_VOCABULARY = `# Actions you can take

You may act on the page by emitting fenced code blocks tagged exactly \`json-action\`
(one JSON object per block, no prose inside). The format is always:

\`\`\`json-action
{"action":"scrollTo","sectionId":"pricing"}
\`\`\`

**Always wrap actions in a \`\`\`json-action fence. Never output action JSON bare
(as a raw line) — it will show up as text in the chat.**

Rules:${ACTION_RULES}
- **If you say you're doing something, do it.** Saying you'll move, scroll,
  highlight or navigate without emitting the matching \`json-action\` block
  is **broken** — the visitor sees the words and nothing happens. **Always**
  emit the block in the same reply where you promise the action. If the user
  asks for an action and you don't emit the block, the request is **silently
  lost** — that is a bug, not a feature.
- Actions available:
  - {"action":"scrollTo","sectionId":"…"} or {"action":"scrollTo","selector":"…"} — smooth-scroll the user to a section/element
  - {"action":"highlight","selector":"…","durationMs":4500} — briefly outline an element (must match exactly one element)
  - {"action":"navigate","path":"/about"} — same-origin navigation only; the user is asked to confirm
  - {"action":"move","near":"pricing"} — move yourself near a sectionId | selector | corner(top-left…) | "x,y"`;

/** Prompt section used when native tool calling is active instead. */
const ACTION_TOOLS_PROMPT = `# Actions you can take

You have tools for acting on the visitor's page: \`scroll_to\`, \`highlight\`,
\`navigate\`, \`move\`. Call the tool that fits — do NOT describe the action in
prose without calling it; saying "let me scroll you there" without the tool
call accomplishes nothing. Prefer tool calls over narration.

Rules:${ACTION_RULES}`;

const str = { type: "string" };

/** The four actions as native-tool JSON schemas (single source of truth). */
export const ACTION_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "scroll_to",
      description: "Smooth-scroll the user to a page section or element (must exist on the CURRENT page).",
      parameters: {
        type: "object",
        properties: { sectionId: str, selector: str },
        description: "Prefer sectionId from the page context; selector must match exactly one element.",
      },
    },
  },
  {
    type: "function",
    function: {
      name: "highlight",
      description: "Briefly outline an element to draw the user's attention (must exist on the CURRENT page).",
      parameters: {
        type: "object",
        properties: { selector: { type: "string", description: "CSS selector, e.g. #growth" }, durationMs: { type: "number", description: "ms to hold the highlight (default 4500)" } },
        required: ["selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Take the user to another page on this site (same-origin). The user confirms first.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path, e.g. /demo/pricing.html" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move",
      description: "Move yourself (the assistant orb) near a section, element, or corner.",
      parameters: {
        type: "object",
        properties: { near: { type: "string", description: "sectionId | selector | corner (top-left, top-right, bottom-left, bottom-right) | \"x,y\"" } },
        required: ["near"],
      },
    },
  },
];

export function assembleSystemMessage(input: {
  systemPrompt: string;
  sourceMarkdown: string;
  pageContext: PageContext;
  tools?: boolean; // native tool calling active → shorter actions section
}): string {
  const { systemPrompt, sourceMarkdown, pageContext: p, tools } = input;
  const parts: string[] = [];

  if (systemPrompt.trim()) parts.push(systemPrompt.trim());
  if (sourceMarkdown.trim()) parts.push(`# Site knowledge\n\n${sourceMarkdown.trim()}`);
  parts.push(tools ? ACTION_TOOLS_PROMPT : ACTION_VOCABULARY);

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

/** tool name → wire Action (fence format the client executor understands) */
export function toolCallToAction(name: string | undefined, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    case "scroll_to":
      return { action: "scrollTo", ...(args.sectionId ? { sectionId: args.sectionId } : {}), ...(args.selector ? { selector: args.selector } : {}) };
    case "highlight":
      return { action: "highlight", ...(args.selector ? { selector: args.selector } : {}), ...(args.durationMs ? { durationMs: args.durationMs } : {}) };
    case "navigate":
      return { action: "navigate", ...(args.path ? { path: args.path } : {}) };
    case "move":
      return { action: "move", ...(args.near ? { near: args.near } : {}) };
    default:
      return null;
  }
}

/** Keep the newest `max` messages; truncate oversized content defensively. */
export function windowHistory(history: ChatMessage[], max: number): ChatMessage[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 16_000) }));
}
