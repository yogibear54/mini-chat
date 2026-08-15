import { describe, it, expect } from "vitest";
import { createRateLimiter, createBudget } from "./ratelimit";

// Seam 5 (agreed): per-IP rate limiting (30/min → 429) and the daily budget
// cap ($5 → 503). PLAN.md §3.2.1 / ticket 03. Pure classes, injected clock.

describe("createRateLimiter", () => {
  it("allows up to N per rolling minute per IP, then blocks", () => {
    const rl = createRateLimiter(3, 60_000, () => 100_000);
    expect(rl.check("1.2.3.4")).toBe(true);
    expect(rl.check("1.2.3.4")).toBe(true);
    expect(rl.check("1.2.3.4")).toBe(true);
    expect(rl.check("1.2.3.4")).toBe(false); // 4th within the window
  });

  it("tracks IPs independently", () => {
    const rl = createRateLimiter(1, 60_000, () => 100_000);
    expect(rl.check("a")).toBe(true);
    expect(rl.check("b")).toBe(true); // different IP unaffected
    expect(rl.check("a")).toBe(false);
  });

  it("window slides — allowed again after the minute passes", () => {
    let now = 100_000;
    const rl = createRateLimiter(1, 60_000, () => now);
    expect(rl.check("a")).toBe(true);
    expect(rl.check("a")).toBe(false);
    now += 60_001;
    expect(rl.check("a")).toBe(true);
  });

  it("forgets idle IPs (no unbounded growth)", () => {
    let now = 0;
    const rl = createRateLimiter(2, 60_000, () => now);
    for (let i = 0; i < 1_000; i++) {
      now = i * 100_000;
      rl.check(`ip${i}`);
    }
    expect(rl.size()).toBeLessThan(1_000);
  });
});

describe("createBudget", () => {
  const PRICE_PER_MTOK = 1; // $1/MTok — easy math

  it("records spend from token usage and stays under the cap", () => {
    let now = 0;
    const b = createBudget(1, PRICE_PER_MTOK, () => now); // $1/day cap
    b.recordUsage(500_000, 0); // $0.50
    expect(b.exceeded()).toBe(false);
    b.recordUsage(0, 400_000); // +$0.40 → $0.90
    expect(b.exceeded()).toBe(false);
  });

  it("trips when the day's spend exceeds the cap", () => {
    let now = 0;
    const b = createBudget(1, PRICE_PER_MTOK, () => now);
    b.recordUsage(1_100_000, 0); // $1.10 > $1
    expect(b.exceeded()).toBe(true);
  });

  it("falls back to estimating tokens (chars/4) when usage is absent", () => {
    let now = 0;
    const b = createBudget(1, PRICE_PER_MTOK, () => now);
    b.recordEstimated("ab".repeat(200_000)); // 400k chars ≈ 100k tokens ≈ $0.10
    expect(b.spent()).toBeCloseTo(0.1, 5);
  });

  it("resets when the calendar day rolls over", () => {
    let now = Date.UTC(2026, 0, 1, 12);
    const b = createBudget(1, PRICE_PER_MTOK, () => now);
    b.recordUsage(2_000_000, 0); // $2 > $1 → exceeded
    expect(b.exceeded()).toBe(true);
    now = Date.UTC(2026, 0, 2, 0, 0, 1); // next day
    expect(b.exceeded()).toBe(false);
    expect(b.spent()).toBe(0);
  });
});
