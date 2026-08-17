// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActionScanner, createExecutor, validateActionShape, parseNavPath } from "./actions";
import type { Action } from "@shared/types";

// Executor integration in jsdom: replay real model replies through the
// scanner + executor and assert the user-observable behaviors (navigate gate,
// scrollTo call, highlight inline styles, toggle off no-op, shadow guard).

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const REAL_NAVIGATE_REPLY =
  "The pricing plans live on their own page — taking you there now.\n\n" +
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

function makeExecutor(
  over: Partial<Parameters<typeof createExecutor>[1]> = {},
  defaults: Parameters<typeof createExecutor>[2] = {},
) {
  const host = document.createElement("div");
  host.id = "mini-chat-host";
  const shadow = host.attachShadow({ mode: "open" });
  const wrap = document.createElement("div");
  wrap.className = "mc-orb-wrap";
  wrap.style.transform = "translate(100px, 100px)";
  shadow.appendChild(wrap);
  document.body.appendChild(host);
  const onNavigate = vi.fn().mockResolvedValue(true);
  const onGaze = vi.fn();
  const onMove = vi.fn();
  const executor = createExecutor(
    () => document.querySelector("#mini-chat-host")?.shadowRoot ?? null,
    { enabled: () => true, onNavigate, onGaze, onMove, ...over },
    defaults,
  );
  return { executor, onNavigate, onGaze, onMove, wrap };
}

function makeHostlessExecutor(over: Partial<Parameters<typeof createExecutor>[1]> = {}) {
  return createExecutor(() => null, {
    enabled: () => true,
    onNavigate: vi.fn().mockResolvedValue(true),
    onGaze: vi.fn(),
    onMove: vi.fn(),
    ...over,
  });
}

describe("scanner replays model reply correctly", () => {
  it("extracts a navigate action and strips it from the prose", () => {
    const { actions, prose } = feedReply(REAL_NAVIGATE_REPLY);
    expect(actions).toEqual([{ action: "navigate", path: "/demo/pricing.html" }]);
    expect(prose).not.toContain("json-action");
    expect(prose).toContain("taking you there now");
  });
});

describe("navigate gate", () => {
  it("routes navigate through the confirm callback (onNavigate)", async () => {
    const { executor, onNavigate } = makeExecutor();
    const { actions } = feedReply(REAL_NAVIGATE_REPLY);
    await executor.execute(actions[0]);
    expect(onNavigate).toHaveBeenCalledWith("/demo/pricing.html");
  });
});

describe("scrollTo", () => {
  it("smooth-centers an existing section", async () => {
    const sec = document.createElement("section");
    sec.id = "pricing";
    document.body.appendChild(sec);
    const { executor } = makeExecutor();
    await executor.execute({ action: "scrollTo", sectionId: "pricing" });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("accepts a bare selector that is really an element id (models drop the #)", async () => {
    const g = document.createElement("div");
    g.id = "growth";
    document.body.appendChild(g);
    const { executor } = makeExecutor();
    await executor.execute({ action: "highlight", selector: "growth" });
    expect(g.getAttribute("data-mini-highlight")).not.toBeNull();
    g.removeAttribute("data-mini-highlight");
  });

  it("warns and does nothing when the section is not on this page", async () => {
    const sec = document.createElement("section");
    sec.id = "hero";
    document.body.appendChild(sec);
    const { executor } = makeExecutor();
    await executor.execute({ action: "scrollTo", sectionId: "pricing" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("highlight", () => {
  it("applies INLINE outline styles (host page element cannot see shadow CSS)", async () => {
    vi.useFakeTimers();
    const g = document.createElement("div");
    g.id = "growth";
    g.textContent = "Growth plan";
    document.body.appendChild(g);
    const { executor } = makeExecutor();
    await executor.execute({ action: "highlight", selector: "#growth" });
    expect(g.style.outline).toContain("solid"); // visible inline
    vi.advanceTimersByTime(5_000);
    expect(g.style.outline).toBe(""); // auto-clears
    vi.useRealTimers();
  });

  it("default highlight duration is 4500ms (long enough to read)", async () => {
    vi.useFakeTimers();
    const g = document.createElement("div");
    g.id = "growth";
    document.body.appendChild(g);
    const { executor } = makeExecutor();
    await executor.execute({ action: "highlight", selector: "#growth" });
    vi.advanceTimersByTime(4_000);
    expect(g.style.outline).toContain("solid"); // still glowing mid-window
    vi.advanceTimersByTime(600);
    expect(g.style.outline).toBe(""); // cleared at ~4500ms
    vi.useRealTimers();
  });

  it("the widget can override the default highlight duration at init time", async () => {
    vi.useFakeTimers();
    const g = document.createElement("div");
    g.id = "growth";
    document.body.appendChild(g);
    const { executor } = makeExecutor({}, { highlightMs: 10_000 });
    await executor.execute({ action: "highlight", selector: "#growth" });
    vi.advanceTimersByTime(4_500);
    expect(g.style.outline).toContain("solid"); // still glowing past the 4500 default
    vi.advanceTimersByTime(5_600);
    expect(g.style.outline).toBe(""); // cleared at the override (10s)
    vi.useRealTimers();
  });

  it("the model's durationMs always wins over the default", async () => {
    vi.useFakeTimers();
    const g = document.createElement("div");
    g.id = "growth";
    document.body.appendChild(g);
    const { executor } = makeExecutor({}, { highlightMs: 10_000 });
    await executor.execute({ action: "highlight", selector: "#growth", durationMs: 1_000 });
    vi.advanceTimersByTime(1_100);
    expect(g.style.outline).toBe(""); // cleared at the model's 1s
    vi.useRealTimers();
  });
});

describe("pure gates (executor policy)", () => {
  it("validateActionShape accepts valid forms, rejects invalid", () => {
    expect(validateActionShape({ action: "scrollTo", sectionId: "pricing" })).toBe(true);
    expect(validateActionShape({ action: "scrollTo", selector: "#p" })).toBe(true);
    expect(validateActionShape({ action: "scrollTo" })).toBe(false);
    expect(validateActionShape({ action: "highlight", selector: "#x" })).toBe(true);
    expect(validateActionShape({ action: "highlight" })).toBe(false);
    expect(validateActionShape({ action: "move", near: "pricing" })).toBe(true);
    expect(validateActionShape({ action: "say", text: "hi" })).toBe(false);
  });

  it("parseNavPath accepts same-origin paths and rejects traversal / schemes", () => {
    expect(parseNavPath("/about")).toBe("/about");
    expect(parseNavPath("/")).toBe("/");
    expect(parseNavPath("/shop?item=2#reviews")).toBe("/shop?item=2#reviews");
    expect(parseNavPath("//evil.com")).toBeNull();
    expect(parseNavPath("https://evil.com")).toBeNull();
    expect(parseNavPath("about")).toBeNull();
    expect(parseNavPath("/x/../../etc")).toBeNull();
    expect(parseNavPath("/x\\y")).toBeNull();
  });
});

describe("guards", () => {
  it("never targets elements inside the widget shadow root", async () => {
    const { executor } = makeExecutor();
    const inside = document.createElement("button");
    inside.id = "orb-inside";
    const shadow = document.querySelector("#mini-chat-host")!.shadowRoot!;
    shadow.appendChild(inside);
    await executor.execute({ action: "highlight", selector: "#orb-inside" });
    expect(inside.style.outline).toBe(""); // untouched
    expect(console.warn).toHaveBeenCalled();
  });

  it("no-ops everything when the toggle is off", async () => {
    const g = document.createElement("div");
    g.id = "growth";
    document.body.appendChild(g);
    const onMove = vi.fn();
    const executor = createExecutor(
      () => document.querySelector("#mini-chat-host")?.shadowRoot ?? null,
      { enabled: () => false, onNavigate: vi.fn().mockResolvedValue(true), onGaze: vi.fn(), onMove },
    );
    await executor.execute({ action: "highlight", selector: "#growth" });
    await executor.execute({ action: "move", near: "growth" });
    expect(g.style.outline).toBe("");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("is safe to call execute with no widget root mounted yet", async () => {
    const executor = makeHostlessExecutor();
    await executor.execute({ action: "scrollTo", sectionId: "anything" });
    await executor.execute({ action: "highlight", selector: "#x" });
    // warn-drop emitted, but no crash
  });
});
