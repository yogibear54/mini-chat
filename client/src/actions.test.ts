import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActionScanner, validateActionShape, parseNavPath, createRateCap } from "./actions";
import type { Action } from "@shared/types";

// Seam 1 (agreed): the client action scanner — token stream in,
// cleaned prose + validated actions out. PLAN.md §3.4 / tickets 04, 06, 07.

function scan(chunks: string[]) {
  const scanner = createActionScanner();
  const actions: Action[] = [];
  let prose = "";
  for (const c of chunks) {
    const out = scanner.feed(c);
    actions.push(...out.actions);
    prose += out.prose;
  }
  const fin = scanner.flush();
  actions.push(...fin.actions);
  prose += fin.prose;
  return { prose, actions };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("action scanner — prose passthrough", () => {
  it("passes plain text through untouched", () => {
    expect(scan(["Hello ", "world"]).prose).toBe("Hello world");
  });

  it("passes ordinary code fences through as prose (never executes)", () => {
    const { prose, actions } = scan([
      "Look:\n\n```js\nconsole.log(1)\n```\n\nAnd:\n\n```json\n{\"action\":\"navigate\"}\n```\n",
    ]);
    expect(actions).toEqual([]);
    expect(prose).toContain("```js");
    expect(prose).toContain("```json");
  });

  it("does not execute a plain ```json code fence", () => {
    const { actions } = scan(["```json\n{\"action\":\"navigate\"}\n```\n"]);
    expect(actions).toEqual([]);
  });

  it("recognizes a fence tag regardless of case (models vary)", () => {
    const { actions, prose } = scan(["```Json-Action\n{\"action\":\"move\",\"near\":\"pricing\"}\n```\nTail."]);
    expect(actions).toEqual([{ action: "move", near: "pricing" }]);
    expect(prose.trim()).toBe("Tail.");
  });
});

describe("action scanner — extraction", () => {
  it("extracts an action and strips it from the prose", () => {
    const { prose, actions } = scan([
      "Let me take you there.\n\n```json-action\n",
      '{"action":"scrollTo","sectionId":"pricing"}',
      "\n```\n\nEnjoy!",
    ]);
    expect(prose).toBe("Let me take you there.\n\n\nEnjoy!");
    expect(actions).toEqual([{ action: "scrollTo", sectionId: "pricing" }]);
  });

  it("extracts multiple actions in document order", () => {
    const { actions } = scan([
      "```json-action\n{\"action\":\"highlight\",\"selector\":\"#plans\"}\n```\n",
      "text between\n",
      "```json-action\n{\"action\":\"move\",\"near\":\"pricing\"}\n```\n",
    ]);
    expect(actions.map((a) => a.action)).toEqual(["highlight", "move"]);
  });

  it("holds prose after an opening fence until the fence closes (safe prefix mid-stream)", () => {
    const scanner = createActionScanner();
    const a = scanner.feed("before\n```json-action\n"); // nothing more yet
    expect(a.prose).toBe("before\n");
    expect(a.actions).toEqual([]);
    const b = scanner.feed('{"action":"move","near":"top-left"}\n```\nafter');
    expect(b.prose).toBe(""); // "after" is a partial line — correctly held
    expect(b.actions).toEqual([{ action: "move", near: "top-left" }]);
    expect(scanner.flush().prose).toBe("after");
  });

  it("handles a fence split across arbitrary token boundaries", () => {
    const text = "```json-action\n{\"action\":\"navigate\",\"path\":\"/about\"}\n```\n";
    const { actions } = scan(text.split("")); // one char per token
    expect(actions).toEqual([{ action: "navigate", path: "/about" }]);
  });

  it("discards invalid JSON in an action fence (+warn) and keeps it out of prose", () => {
    const { prose, actions } = scan(["```json-action\n{not json\n```\nvisible"]);
    expect(actions).toEqual([]);
    expect(prose).toBe("visible");
    expect(console.warn).toHaveBeenCalled();
  });

  it("discards an unclosed fence at end of stream (+warn)", () => {
    const { prose, actions } = scan(["ok\n```json-action\n{\"action\":\"move\",\"near\":\"x\"}"]);
    expect(actions).toEqual([]);
    expect(prose).toBe("ok\n");
    expect(console.warn).toHaveBeenCalled();
  });

  it("emits parsed-but-unknown action shapes for the executor to reject", () => {
    // scanner parses known-allowlist actions only; unknown type → dropped+warn
    const { actions } = scan(["```json-action\n{\"action\":\"explode\"}\n```\n"]);
    expect(actions).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("action scanner — bare (unfenced) action fallback", () => {
  it("executes a bare single-line action object and strips it from prose", () => {
    const { prose, actions } = scan([
      "The About page is at /demo/about.html — want to go?\n",
      '{"action":"navigate","path":"/demo/about.html"}',
      "\n",
    ]);
    expect(actions).toEqual([{ action: "navigate", path: "/demo/about.html" }]);
    expect(prose.trim()).toBe("The About page is at /demo/about.html — want to go?");
  });

  it("executes a bare multi-line action object", () => {
    const { prose, actions } = scan([
      "Sure —\n{\n",
      '  "action": "scrollTo",',
      '\n  "sectionId": "pricing"\n}\n',
      "There you are.",
    ]);
    expect(actions).toEqual([{ action: "scrollTo", sectionId: "pricing" }]);
    expect(prose.trim()).toBe("Sure —\nThere you are.");
  });

  it("leaves non-action JSON objects as prose", () => {
    const { prose, actions } = scan(["Config: {\"debug\": true}\n"]);
    expect(actions).toEqual([]);
    expect(prose).toContain('{"debug": true}');
  });

  it("never executes action JSON inside an ordinary code fence", () => {
    const { prose, actions } = scan([
      "Example block:\n```json\n",
      '{"action":"navigate","path":"/about"}',
      "\n```\ndone\n",
    ]);
    expect(actions).toEqual([]);
    expect(prose).toContain('{"action":"navigate","path":"/about"}');
  });

  it("does not mangle prose containing unbalanced braces", () => {
    const { prose, actions } = scan(["Smile {not json\nstill prose\n"]);
    expect(actions).toEqual([]);
    expect(prose).toContain("Smile {not json");
    expect(prose).toContain("still prose");
  });
});

describe("validateActionShape (executor gate, ticket 07)", () => {
  it("accepts a scrollTo with sectionId or selector", () => {
    expect(validateActionShape({ action: "scrollTo", sectionId: "pricing" })).toBe(true);
    expect(validateActionShape({ action: "scrollTo", selector: "#p" })).toBe(true);
  });

  it("rejects scrollTo with no target", () => {
    expect(validateActionShape({ action: "scrollTo" })).toBe(false);
  });

  it("accepts highlight (selector required) and move (near required)", () => {
    expect(validateActionShape({ action: "highlight", selector: "#x" })).toBe(true);
    expect(validateActionShape({ action: "highlight" })).toBe(false);
    expect(validateActionShape({ action: "move", near: "pricing" })).toBe(true);
  });

  it("rejects non-objects and unknown action types", () => {
    expect(validateActionShape(null)).toBe(false);
    expect(validateActionShape("navigate")).toBe(false);
    expect(validateActionShape({ action: "say", text: "hi" })).toBe(false);
  });
});

describe("parseNavPath (same-origin guard, ticket 07)", () => {
  it("accepts same-origin absolute paths", () => {
    expect(parseNavPath("/about")).toBe("/about");
    expect(parseNavPath("/")).toBe("/");
    expect(parseNavPath("/shop?item=2#reviews")).toBe("/shop?item=2#reviews");
  });

  it("rejects protocol-relative, schemed, relative, and ../ escapes", () => {
    expect(parseNavPath("//evil.com")).toBe(null);
    expect(parseNavPath("https://evil.com")).toBe(null);
    expect(parseNavPath("about")).toBe(null);
    expect(parseNavPath("/x/../../etc")).toBe(null);
    expect(parseNavPath("/x\\y")).toBe(null);
  });
});

describe("createRateCap (8 actions / 5 s, ticket 07)", () => {
  it("allows up to 8 within the window, drops the 9th", () => {
    const cap = createRateCap();
    const now = 1_000;
    for (let i = 0; i < 8; i++) expect(cap.allow(now)).toBe(true);
    expect(cap.allow(now)).toBe(false);
  });

  it("slides: actions after the window closes are allowed again", () => {
    const cap = createRateCap();
    const t = 10_000;
    for (let i = 0; i < 8; i++) cap.allow(t);
    expect(cap.allow(t + 1)).toBe(false);
    expect(cap.allow(t + 5_001)).toBe(true);
  });
});
