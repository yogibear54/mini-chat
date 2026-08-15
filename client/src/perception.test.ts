import { describe, it, expect } from "vitest";
import { deriveLabel, slugify, assignId } from "./perception";

// Seam 3 (agreed): the PURE perception helpers — label priority + namespaced
// auto-ids. The DOM scan / IntersectionObserver / route watcher are
// manually verified. PLAN.md §3.3 / ticket 09.

describe("deriveLabel — priority aria-label → data-mini-label → heading → id", () => {
  const base = { aria: "", mini: "", heading: "", id: "fallback-id" };

  it("prefers aria-label", () => {
    expect(deriveLabel({ ...base, aria: "Pricing", mini: "Cost", heading: "H", id: "i" })).toBe("Pricing");
  });

  it("then data-mini-label", () => {
    expect(deriveLabel({ ...base, mini: "Cost", heading: "H", id: "i" })).toBe("Cost");
  });

  it("then heading text", () => {
    expect(deriveLabel({ ...base, heading: "  Plans & pricing ", id: "i" })).toBe("Plans & pricing");
  });

  it("then the id", () => {
    expect(deriveLabel({ ...base, id: "plans-42" })).toBe("plans-42");
  });

  it("truncates long labels to ~80 chars", () => {
    const long = "a".repeat(200);
    expect(deriveLabel({ ...base, heading: long, id: "i" }).length).toBe(80);
  });
});

describe("slugify", () => {
  it("lowercases, collapses spaces/punctuation to dashes", () => {
    expect(slugify("Plans & Pricing!")).toBe("plans-pricing");
    expect(slugify("  About   Us  ")).toBe("about-us");
  });

  it("keeps letters (incl. accents stripped) and numbers", () => {
    expect(slugify("FAQ 2: Café")).toBe("faq-2-cafe");
  });

  it("yields 'section' for empty/punct-only input", () => {
    expect(slugify("")).toBe("section");
    expect(slugify("!!!")).toBe("section");
  });
});

describe("assignId — existing or namespaced mini-s-<slug>, collisions suffixed", () => {
  it("uses an existing id as-is", () => {
    expect(assignId("pricing", "Pricing", new Set())).toBe("pricing");
  });

  it("auto-assigns mini-s-<slug> when no id", () => {
    expect(assignId("", "Plans & Pricing", new Set())).toBe("mini-s-plans-pricing");
  });

  it("suffixes -2, -3 on collision with host ids or prior auto-ids", () => {
    expect(assignId("", "Pricing", new Set(["mini-s-pricing"]))).toBe("mini-s-pricing-2");
    expect(assignId("", "Pricing", new Set(["mini-s-pricing", "mini-s-pricing-2"]))).toBe("mini-s-pricing-3");
  });

  it("ensures the auto-id starts with a letter (validity prefix)", () => {
    expect(assignId("", "42 Things", new Set())).toBe("mini-s-s42-things");
  });
});
