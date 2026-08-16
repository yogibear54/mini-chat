// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActionScanner, createExecutor } from "./actions";
import type { Action } from "@shared/types";

// Executor integration (browser-like jsdom): replay REAL model replies through
// scanner + executor and assert what the user should have seen happen.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

/** The reply the model actually produced (captured live, 2026-08-15). */
const REAL_NAVIGATE_REPLY =
  'The pricing plans live on their own page — taking you there now.\n\n' +
  '```json-action\n{"action":"navigate","path":"/demo/pricing.html"}\n```\n';

function feedReply(reply: string) {
  const scanner = createActionScanner();
  const actions: Action[] = [];
  let prose = "";
  for (const chunk of reply.match(/[\s\S]{1,7}/g) ?? []) {
    const out = scanner.feed(chunk);
    actions.push(...out.actions);
    prose += out.prose;
  }
  const fin = scanner.flush();
  actions.push(...fin.actions);
  prose += fin.prose;
  return { actions, prose };
}

function makeExecutor(over: Partial<Parameters<typeof createExecutor>[1]> = {}) {
  const shadow = document.createElement("div").attachShadow({ mode: "open" });
  const onNavigate = vi.fn().mockResolvedValue(true);
  const onGaze = vi.fn();
  const onMove = vi.fn();
  const executor = createExecutor(() => shadow, {
    enabled: () => true,
    onNavigate,
    onGaze,
    onMove,
    ...over,
  });
  return { executor, onNavigate, onGaze, onMove, shadow };
}

describe("replaying the real model reply", () => {
  it("scanner extracts the navigate action and strips it from prose", () => {
    const { actions, prose } = feedReply(REAL_NAVIGATE_REPLY);
    expect(actions).toEqual([{ action: "navigate", path: "/demo/pricing.html" }]);
    expect(prose).not.toContain("json-action");
    expect(prose).toContain("taking you there now");
  });

  it("executor routes navigate through the confirm gate (onNavigate)", async () => {
    const { executor, onNavigate } = makeExecutor();
    const { actions } = feedReply(REAL_NAVIGATE_REPLY);
    await executor.execute(actions[0]);
    expect(onNavigate).toHaveBeenCalledWith("/demo/pricing.html");
  });
});

describe("scrollTo", () => {
  it("smooth-centers an existing section", async () => {
    document.body.innerHTML = '<section id="pricing">Pricing</section>';
    const { executor } = makeExecutor();
    await executor.execute({ action: "scrollTo", sectionId: "pricing" });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("resolves a bare selector that is really an element id (models drop the #)", async () => {
    document.body.innerHTML = '<div id="growth">Growth</div>';
    const { executor } = makeExecutor();
    await executor.execute({ action: "highlight", selector: "growth" });
    const el = document.getElementById("growth")!;
    expect(el.getAttribute("data-mini-highlight")).toBe(""); // acted on the right element
    el.removeAttribute("data-mini-highlight");
  });

  it("drops silently when the section is not on this page", async () => {
    document.body.innerHTML = '<section id="hero">Home</section>';
    const { executor, onNavigate } = makeExecutor();
    await executor.execute({ action: "scrollTo", sectionId: "pricing" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("highlight", () => {
  it("is VISIBLE on the host page: inline outline styles (not shadow CSS)", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="growth">Growth plan</div>';
    const { executor } = makeExecutor();
    await executor.execute({ action: "highlight", selector: "#growth" });
    const el = document.getElementById("growth")!;
    // the bug we're regression-testing: styles must be INLINE (host page
    // elements cannot see the widget's shadow-root stylesheet)
    expect(el.style.outline).not.toBe("");
    expect(el.style.outline).toContain("solid"); // visible outline applied inline
    vi.advanceTimersByTime(2_100);
    expect(el.style.outline).toBe(""); // auto-clears
    vi.useRealTimers();
  });
});

describe("guards", () => {
  it("never targets elements inside the widget shadow root", async () => {
    const { executor, shadow } = makeExecutor();
    const inside = document.createElement("button");
    inside.id = "orb-inside";
    shadow.appendChild(inside);
    await executor.execute({ action: "highlight", selector: "#orb-inside" });
    expect(inside.style.outline).toBe(""); // untouched
    expect(console.warn).toHaveBeenCalled();
  });

  it("no-ops everything when the toggle is off", async () => {
    document.body.innerHTML = '<div id="growth">G</div>';
    const { executor, onMove } = makeExecutor({ enabled: () => false });
    await executor.execute({ action: "highlight", selector: "#growth" });
    await executor.execute({ action: "move", near: "growth" });
    expect(document.getElementById("growth")!.style.outline).toBe("");
    expect(onMove).not.toHaveBeenCalled();
  });
});
