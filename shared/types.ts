// Wire types — single source of truth (PLAN.md §5, finalized by tickets 10/07).
// Only the backend ever produces a system message; the client sends
// user/assistant turns only.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SectionRef {
  id: string;
  label: string;
}

export interface PageContext {
  url: string;
  title: string;
  path: string;
  metaDescription?: string;
  sections: SectionRef[];
  currentSectionId?: string;
}

export type Action =
  | { action: "scrollTo"; sectionId?: string; selector?: string }
  | { action: "highlight"; selector: string; durationMs?: number }
  | { action: "navigate"; path: string }
  | { action: "move"; near: string }; // sectionId | selector | corner | "x,y"

export interface ChatRequest {
  sessionId: string; // which SSE stream(s) receive the response (fan-out, §3.2.2)
  agentId: string; // forward-compat only; server-ignored no-op for MVP
  history: ChatMessage[]; // FULL conversation, new user message last
  pageContext: PageContext;
}

export type ServerEvent =
  | { type: "token"; value: string } // streamed content chunk
  | { type: "done"; requestId: string } // turn complete
  | { type: "error"; message: string }; // backend/provider error (HTTP 429/503 are separate, §3.2.1)

export type ExpressionState = "idle" | "thinking" | "speaking" | "done";

export interface Prefs {
  actionsEnabled?: boolean; // default true
  position?: { x: number; y: number } | string; // corner keyword or coords
}

export interface StoredSession {
  sessionId: string;
  createdAt: number;
  history: ChatMessage[]; // cleaned prose only (action fences stripped, §3.6)
  prefs: Prefs;
}
