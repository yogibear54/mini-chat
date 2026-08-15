import type { ServerEvent } from "@shared/types";

// Sessions (PLAN.md §3.2.2): sessionId → SET of open SSE streams (fan-out).
// Turns are tracked per session; when the LAST stream for a session closes
// mid-turn, in-flight provider calls are aborted (no spend with no reader).

export interface Stream {
  send(event: ServerEvent): void;
}

export class SessionRegistry {
  private streams = new Map<string, Set<Stream>>();
  private turns = new Map<string, Set<AbortController>>();

  addStream(sessionId: string, stream: Stream): void {
    let set = this.streams.get(sessionId);
    if (!set) {
      set = new Set();
      this.streams.set(sessionId, set);
    }
    set.add(stream);
  }

  removeStream(sessionId: string, stream: Stream): void {
    const set = this.streams.get(sessionId);
    if (!set) return;
    set.delete(stream);
    if (set.size === 0) {
      this.streams.delete(sessionId);
      this.abortTurns(sessionId); // last reader gone → stop the spend
    }
  }

  fanout(sessionId: string, event: ServerEvent): void {
    for (const s of this.streams.get(sessionId) ?? []) s.send(event);
  }

  hasStream(sessionId: string): boolean {
    return (this.streams.get(sessionId)?.size ?? 0) > 0;
  }

  trackTurn(sessionId: string, controller: AbortController): void {
    let set = this.turns.get(sessionId);
    if (!set) {
      set = new Set();
      this.turns.set(sessionId, set);
    }
    set.add(controller);
  }

  untrackTurn(sessionId: string, controller: AbortController): void {
    this.turns.get(sessionId)?.delete(controller);
  }

  abortTurns(sessionId: string): void {
    for (const c of this.turns.get(sessionId) ?? []) c.abort();
    this.turns.delete(sessionId);
  }
}
