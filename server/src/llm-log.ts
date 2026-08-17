import { appendFileSync, accessSync, constants as fsConstants, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

// LLM traffic log (JSONL): every request sent to the provider and every
// response (or error/abort) gets one line, so the raw payloads can be
// tailed live:  tail -f server/logs/llm.jsonl
//
// Records carry an auto `ts` (ISO). appendFileSync (not a buffered stream)
// so each line is on disk immediately — tail-friendly.
//
// Hard rule: logging must never break (or block!) the chat path. mkdirSync
// against virtual filesystems (/proc, /sys) can BLOCK forever on some
// systems, so we verify a writable ancestor first and degrade to no-op.

export interface LlmLog {
  enabled: boolean;
  write(record: Record<string, unknown>): void;
}

export function createLlmLog(path: string | null | undefined, enabled: boolean): LlmLog {
  if (!enabled || !path) return { enabled: false, write: () => {} };
  const dir = dirname(resolve(path));
  if (!hasWritableAncestor(dir)) {
    console.warn(`[mini-chat] llm log: no writable ancestor for ${dir} — logging disabled`);
    return { enabled: false, write: () => {} };
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    console.warn(`[mini-chat] llm log: cannot create ${dir} — logging disabled`);
    return { enabled: false, write: () => {} };
  }
  return {
    enabled: true,
    write(record: Record<string, unknown>) {
      try {
        appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
      } catch (err) {
        console.warn("[mini-chat] llm log write failed:", err instanceof Error ? err.message : err);
      }
    },
  };
}

/** Nearest existing ancestor of `dir` is a directory we can write to? */
function hasWritableAncestor(dir: string): boolean {
  try {
    let cur = dir;
    while (!existsSync(cur)) {
      const parent = cur.slice(0, cur.lastIndexOf(sep));
      if (!parent || parent === cur) break; // reached fs root
      cur = parent;
    }
    if (!cur) return false;
    accessSync(cur, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
