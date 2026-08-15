import type { ChatMessage, Prefs, StoredSession } from "@shared/types";

// Memory layer (PLAN.md §3.6 / ticket 08). Behind a small interface so a
// backend-sync implementation is a drop-in swap.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Memory {
  load(): StoredSession | null;
  save(session: StoredSession): void;
  /** Wipe history + rotate sessionId; prefs survive (§3.6). Persists the result. */
  clearChat(): StoredSession;
}

const MAX_MESSAGES = 100;
const MAX_BYTES = 100 * 1024;

function isValid(session: unknown): session is StoredSession {
  if (typeof session !== "object" || session === null) return false;
  const s = session as StoredSession;
  if (typeof s.sessionId !== "string" || typeof s.createdAt !== "number") return false;
  if (!Array.isArray(s.history) || typeof s.prefs !== "object" || s.prefs === null) return false;
  return s.history.every(
    (m: ChatMessage) =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
}

/** Strip system messages (never persisted — backend injects, §3.6). */
function cleanHistory(history: ChatMessage[]): ChatMessage[] {
  return history.filter((m) => m.role === "user" || m.role === "assistant");
}

/** Enforce BOTH caps: ≤100 messages and ≤100KB serialized; drop oldest first. */
function cap(history: ChatMessage[]): ChatMessage[] {
  let h = cleanHistory(history);
  while (h.length > MAX_MESSAGES) h = h.slice(1);
  while (JSON.stringify(h).length > MAX_BYTES && h.length > 1) h = h.slice(1);
  return h;
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createMemory(agentId: string, storage: StorageLike): Memory {
  const key = `mini-chat:${agentId}`;
  let fallback: StoredSession | null = null; // used when storage throws (private mode)

  function load(): StoredSession | null {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return fallback;
    }
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (isValid(parsed)) return parsed;
      console.warn("[mini-chat] stored session invalid — resetting");
    } catch {
      console.warn("[mini-chat] stored session corrupt — resetting");
    }
    return fallback;
  }

  function save(session: StoredSession): void {
    const next: StoredSession = { ...session, history: cap(session.history) };
    fallback = next; // always keep the in-memory mirror current
    try {
      storage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode / quota — mirror above keeps the session alive */
    }
  }

  function clearChat(): StoredSession {
    const prev = load();
    const fresh: StoredSession = {
      sessionId: newSessionId(), // rotated (§3.2.2)
      createdAt: Date.now(),
      history: [],
      prefs: (prev?.prefs ?? {}) as Prefs, // prefs survive the clear
    };
    save(fresh);
    return fresh;
  }

  return { load, save, clearChat };
}

/** Default: the browser's localStorage. */
export function browserMemory(agentId: string): Memory {
  return createMemory(agentId, globalThis.localStorage);
}
