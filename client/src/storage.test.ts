import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemory } from "./storage";
import type { ChatMessage, StoredSession } from "@shared/types";

// Seam 2 (agreed): localStorage memory policy — caps, validation, fallback,
// clear-chat semantics. PLAN.md §3.6 / ticket 08.

function msg(role: "user" | "assistant", content = "x"): ChatMessage {
  return { role, content };
}

function freshSession(over: Partial<StoredSession> = {}): StoredSession {
  return { sessionId: "s1", createdAt: 1, history: [msg("user", "hi")], prefs: {}, ...over };
}

/** Minimal localStorage-compatible fake. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

/** localStorage that throws like a banned storage partition. */
function blockedStorage() {
  const boom = () => {
    throw new Error("The operation is insecure.");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("load / save round-trip", () => {
  it("round-trips a session under mini-chat:{agentId}", () => {
    const ls = fakeStorage();
    const mem = createMemory("default", ls);
    mem.save(freshSession({ history: [msg("user", "hi"), msg("assistant", "hello!")] }));
    expect(ls._map.get("mini-chat:default")).toBeTruthy();
    const loaded = mem.load();
    expect(loaded?.history).toHaveLength(2);
    expect(loaded?.sessionId).toBe("s1");
  });

  it("returns null when nothing is stored", () => {
    expect(createMemory("default", fakeStorage()).load()).toBeNull();
  });
});

describe("corrupt data → validate → reset", () => {
  it("resets to null (+warn) on invalid JSON", () => {
    const ls = fakeStorage();
    ls.setItem("mini-chat:default", "{not json");
    expect(createMemory("default", ls).load()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("resets to null on wrong shape (history not an array / bad role)", () => {
    const ls = fakeStorage();
    ls.setItem("mini-chat:default", JSON.stringify({ sessionId: "s", createdAt: 0, history: "nope", prefs: {} }));
    expect(createMemory("default", ls).load()).toBeNull();
    ls.setItem(
      "mini-chat:default",
      JSON.stringify({ sessionId: "s", createdAt: 0, history: [{ role: "system", content: "no" }], prefs: {} }),
    );
    expect(createMemory("default", ls).load()).toBeNull();
  });

  it("drops the system message from a stored history (never persisted)", () => {
    const ls = fakeStorage();
    const mem = createMemory("default", ls);
    mem.save(freshSession({ history: [{ role: "system", content: "sys" }, msg("user")] }));
    // save applies the same validation: system messages are stripped on save
    expect(mem.load()?.history).toEqual([msg("user")]);
  });
});

describe("rolling caps — ≤100 messages AND ≤100KB, oldest first", () => {
  it("evicts oldest beyond 100 messages", () => {
    const ls = fakeStorage();
    const mem = createMemory("default", ls);
    const history = Array.from({ length: 120 }, (_, i) => msg(i % 2 ? "assistant" : "user", `m${i}`));
    mem.save(freshSession({ history }));
    const loaded = mem.load()!;
    expect(loaded.history).toHaveLength(100);
    expect(loaded.history[0].content).toBe("m20"); // oldest dropped
    expect(loaded.history[99].content).toBe("m119");
  });

  it("evicts oldest when the 100KB serialized cap trips first", () => {
    const ls = fakeStorage();
    const mem = createMemory("default", ls);
    const big = "y".repeat(2_000); // ~2KB each → 60 messages ≈ 120KB+ envelope
    const history = Array.from({ length: 60 }, (_, i) => msg(i % 2 ? "assistant" : "user", `${i}:${big}`));
    mem.save(freshSession({ history }));
    const loaded = mem.load()!;
    expect(JSON.stringify(loaded.history).length).toBeLessThanOrEqual(100 * 1024);
    expect(loaded.history.length).toBeGreaterThan(0);
    expect(loaded.history.length).toBeLessThan(60);
    // newest survive
    const last = loaded.history[loaded.history.length - 1].content;
    expect(last.startsWith("59:")).toBe(true);
  });
});

describe("disabled storage → in-memory fallback", () => {
  it("falls back silently when storage throws", () => {
    const mem = createMemory("default", blockedStorage());
    expect(mem.load()).toBeNull(); // no crash
    mem.save(freshSession());
    expect(mem.load()?.sessionId).toBe("s1"); // in-memory round-trip works
  });
});

describe("clearChat — history + sessionId wiped, prefs survive", () => {
  it("returns a fresh session keeping prefs, and persists it", () => {
    const ls = fakeStorage();
    const mem = createMemory("default", ls);
    mem.save(freshSession({ prefs: { actionsEnabled: false, position: { x: 10, y: 20 } } }));
    const fresh = mem.clearChat();
    expect(fresh.history).toEqual([]);
    expect(fresh.sessionId).not.toBe("s1");
    expect(fresh.prefs).toEqual({ actionsEnabled: false, position: { x: 10, y: 20 } });
    expect(mem.load()?.history).toEqual([]); // persisted
    expect(mem.load()?.prefs.actionsEnabled).toBe(false);
  });
});
