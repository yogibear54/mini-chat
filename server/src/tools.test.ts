import { describe, it, expect } from "vitest";
import { toolCallToAction, ACTION_TOOLS } from "./context";

// toolCallToAction: native tool name + args → the wire Action the client
// executor understands. Must cover all four actions and reject unknowns.

describe("ACTION_TOOLS schemas", () => {
  it("defines exactly the four actions with function type", () => {
    expect(ACTION_TOOLS.map((t) => t.function.name).sort()).toEqual(
      ["highlight", "move", "navigate", "scroll_to"].sort(),
    );
    for (const t of ACTION_TOOLS) expect(t.type).toBe("function");
  });
});

describe("toolCallToAction", () => {
  it("maps scroll_to", () => {
    expect(toolCallToAction("scroll_to", { sectionId: "pricing" })).toEqual({
      action: "scrollTo",
      sectionId: "pricing",
    });
    expect(toolCallToAction("scroll_to", { selector: "#p" })).toEqual({
      action: "scrollTo",
      selector: "#p",
    });
  });

  it("maps highlight with optional duration", () => {
    expect(toolCallToAction("highlight", { selector: "#growth", durationMs: 5000 })).toEqual({
      action: "highlight",
      selector: "#growth",
      durationMs: 5000,
    });
  });

  it("maps navigate and move", () => {
    expect(toolCallToAction("navigate", { path: "/demo/pricing.html" })).toEqual({
      action: "navigate",
      path: "/demo/pricing.html",
    });
    expect(toolCallToAction("move", { near: "growth" })).toEqual({ action: "move", near: "growth" });
  });

  it("rejects unknown tool names", () => {
    expect(toolCallToAction("explode", {})).toBeNull();
    expect(toolCallToAction(undefined, {})).toBeNull();
  });
});
