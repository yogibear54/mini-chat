// Abuse core (PLAN.md §3.2.1 / ticket 03). In-memory, single-instance (a
// shared store is needed for multi-instance — documented limitation).

export function createRateLimiter(
  limitPerMinute: number,
  windowMs = 60_000,
  now: () => number = Date.now,
) {
  const hits = new Map<string, number[]>();

  return {
    check(ip: string): boolean {
      const t = now();
      sweep(t);
      const recent = (hits.get(ip) ?? []).filter((ts) => t - ts < windowMs);
      if (recent.length >= limitPerMinute) {
        hits.set(ip, recent);
        return false;
      }
      recent.push(t);
      hits.set(ip, recent);
      return true;
    },
    size(): number {
      return hits.size;
    },
  };

  /** Drop keys with no hits left in the window (no unbounded growth). */
  function sweep(t: number) {
    for (const [ip, ts] of hits) {
      if (!ts.some((x) => t - x < windowMs)) hits.delete(ip);
    }
  }
}

export function createBudget(
  capUsdPerDay: number,
  pricePerMTok: number,
  now: () => number = Date.now,
) {
  let day = dayKey(now());
  let spentUsd = 0;

  function rollDay() {
    const today = dayKey(now());
    if (today !== day) {
      day = today;
      spentUsd = 0; // resets daily (§3.2.1)
    }
  }

  return {
    recordUsage(promptTokens = 0, completionTokens = 0) {
      rollDay();
      spentUsd += ((promptTokens + completionTokens) / 1_000_000) * pricePerMTok;
    },
    /** Rough estimate when the provider reports no usage: chars/4 ≈ tokens. */
    recordEstimated(text: string) {
      rollDay();
      spentUsd += (text.length / 4 / 1_000_000) * pricePerMTok;
    },
    spent(): number {
      rollDay();
      return spentUsd;
    },
    exceeded(): boolean {
      rollDay();
      return spentUsd >= capUsdPerDay;
    },
  };
}

function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10); // UTC day
}
