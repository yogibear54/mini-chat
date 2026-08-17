import { describe, it, expect, vi } from "vitest";
import { createLlmLog } from "./llm-log";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// LLM traffic log: one JSONL line per record, immediately tail-able.
// Logging must NEVER break the chat path — failures are swallowed.

function tmpLog() {
  const dir = mkdtempSync(join(tmpdir(), "mc-log-"));
  return { dir, path: join(dir, "llm.jsonl") };
}

describe("createLlmLog", () => {
  it("appends JSONL records with an auto timestamp", () => {
    const { path, dir } = tmpLog();
    const log = createLlmLog(path, true);
    log.write({ type: "request", sessionId: "s1", messages: [{ role: "user", content: "hi" }] });
    log.write({ type: "response", sessionId: "s1", text: "hello", status: "done" });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const req = JSON.parse(lines[0]);
    const res = JSON.parse(lines[1]);
    expect(req.type).toBe("request");
    expect(req.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(typeof req.ts).toBe("string"); // timestamp injected
    expect(res.text).toBe("hello");
    expect(res.status).toBe("done");
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the log directory on first write (nested path)", () => {
    const { dir } = tmpLog();
    const nested = join(dir, "a", "b", "llm.jsonl");
    const log = createLlmLog(nested, true);
    log.write({ type: "response", text: "x" });
    expect(existsSync(nested)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op when disabled (no file created)", () => {
    const { path, dir } = tmpLog();
    const log = createLlmLog(path, false);
    log.write({ type: "response", text: "x" });
    expect(existsSync(path)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("never throws when the path is unwritable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLlmLog("/proc/definitely/not/writable/llm.jsonl", true);
    expect(() => log.write({ type: "response", text: "x" })).not.toThrow();
    warn.mockRestore();
  });
});
