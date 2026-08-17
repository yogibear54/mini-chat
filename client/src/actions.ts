import type { Action } from "@shared/types";

// ─── Scanner (pure) ─────────────────────────────────────────────────────────
// Incremental json-action fence scanner (PLAN.md §3.4, tickets 04/06).
// feed(chunk) → { prose: text safe to render now, actions: newly completed }
// Only fences tagged EXACTLY `json-action` (case-sensitive) are parsed+executed;
// every other fence is ordinary prose. Malformed/unclosed → discard + warn.

const OPEN_RE = /^ {0,3}```json-action\s*$/i; // case-insensitive tag
const CLOSE_RE = /^ {0,3}```\s*$/;
const ANY_FENCE_RE = /^ {0,3}```/;
const ALLOWED: Action["action"][] = ["scrollTo", "highlight", "navigate", "move"];

export interface ScanResult {
  prose: string;
  actions: Action[];
}

export function createActionScanner() {
  let lineBuf = ""; // partial line waiting for \n
  let inside = false; // inside a json-action fence
  let inCode = false; // inside an ordinary code fence — passthrough, never execute
  let body: string[] = []; // fence body lines
  // bare (unfenced) action-object collection: models sometimes drop the fence
  let bare: string[] = [];
  let bareDepth = 0;

  function pushBare(line: string) {
    bare.push(line);
    bareDepth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
  }

  /** Balanced bare object: valid action → execute; otherwise it's prose. */
  function resolveBare(out: ScanResult) {
    const text = bare.join("\n");
    bare = [];
    bareDepth = 0;
    try {
      const obj = JSON.parse(text);
      if (validateActionShape(obj)) {
        out.actions.push(obj as Action);
        return;
      }
    } catch {
      /* not JSON — ordinary prose */
    }
    out.prose += text + "\n";
  }

  function flushBare(out: ScanResult) {
    if (bare.length === 0) return;
    const text = bare.join("\n");
    bare = [];
    bareDepth = 0;
    out.prose += text + "\n"; // unbalanced at end of stream → it was prose
  }

  function finishLine(line: string, out: ScanResult) {
    if (!inside) {
      if (OPEN_RE.test(line)) {
        flushBare(out);
        inside = true;
        body = [];
        return;
      }
      if (ANY_FENCE_RE.test(line)) {
        // ordinary code fence: toggle passthrough mode (never execute contents)
        flushBare(out);
        inCode = !inCode;
        out.prose += line + "\n";
        return;
      }
      if (inCode) {
        out.prose += line + "\n";
        return;
      }
      if (bare.length > 0) {
        pushBare(line);
        if (bareDepth <= 0) resolveBare(out);
        return;
      }
      if (line.trimStart().startsWith("{")) {
        pushBare(line);
        if (bareDepth <= 0) resolveBare(out);
        return;
      }
      out.prose += line + "\n";
      return;
    }
    if (CLOSE_RE.test(line)) {
      inside = false;
      const action = parseAction(body.join("\n"));
      body = [];
      if (action) out.actions.push(action);
      return;
    }
    body.push(line);
  }

  function parseAction(json: string): Action | null {
    try {
      const obj = JSON.parse(json);
      if (validateActionShape(obj)) return obj as Action;
      console.warn("[mini-chat] dropped unknown/malformed action:", json);
      return null;
    } catch {
      console.warn("[mini-chat] dropped invalid action JSON");
      return null;
    }
  }

  return {
    feed(chunk: string): ScanResult {
      const out: ScanResult = { prose: "", actions: [] };
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) !== -1) {
        const line = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        finishLine(line, out);
      }
      return out;
    },
    flush(): ScanResult {
      const out: ScanResult = { prose: "", actions: [] };
      if (lineBuf !== "") {
        if (inside) {
          // final unterminated line inside a fence: a closing fence still counts
          // (real models end streams with "```" and no trailing newline)
          if (CLOSE_RE.test(lineBuf)) {
            inside = false;
            const action = parseAction(body.join("\n"));
            body = [];
            if (action) out.actions.push(action);
          }
          // else: partial fence BODY — discarded below
        } else if (!inCode && (bare.length > 0 || lineBuf.trimStart().startsWith("{"))) {
          pushBare(lineBuf);
          if (bareDepth <= 0) resolveBare(out);
        } else {
          out.prose += lineBuf; // partial PROSE line — emit as-is, no added \n
        }
        lineBuf = "";
      }
      flushBare(out);
      if (inside) {
        console.warn("[mini-chat] discarded unclosed action fence at end of stream");
        inside = false;
        body = [];
      }
      return out;
    },
  };
}

// ─── Pure gates (executor policy, ticket 07) ────────────────────────────────

export function validateActionShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  switch (a.action) {
    case "scrollTo":
      return typeof a.sectionId === "string" || typeof a.selector === "string";
    case "highlight":
      return typeof a.selector === "string";
    case "navigate":
      return typeof a.path === "string";
    case "move":
      return typeof a.near === "string";
    default:
      return false;
  }
}

/** Same-origin absolute path only ("/x", "/x?y#z"). Else null. */
export function parseNavPath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//") || path.includes("\\") || path.includes("://")) return null;
  if (/(^|\/)\.\.?(\/|$)/.test(path)) return null; // no . / .. segments
  return path;
}

/** Sliding-window rate cap: `limit` actions per `windowMs` (default 8/5s). */
export function createRateCap(limit = 8, windowMs = 5_000) {
  let times: number[] = [];
  return {
    allow(now: number): boolean {
      times = times.filter((t) => now - t < windowMs);
      if (times.length >= limit) return false;
      times.push(now);
      return true;
    },
  };
}

// ─── DOM executor (thin; policy above is pure) ──────────────────────────────

const FORBIDDEN_TAGS = new Set([
  "SCRIPT", "STYLE", "HEAD", "TITLE", "META", "LINK", "TEMPLATE", "NOSCRIPT",
]);

export interface ExecutorOptions {
  enabled: () => boolean; // action toggle (persisted pref, default ON)
  onNavigate: (path: string) => Promise<boolean>; // one-tap confirm; true = go
  onGaze: (target: { x: number; y: number } | null) => void; // orb eye target
  onMove: (near: string) => void; // delegate to the movement engine
}

/** Defaults the widget can override at init time. */
export interface ExecutorDefaults {
  highlightMs: number; // applied when the model doesn't set durationMs
}

const DEFAULT_HIGHLIGHT_MS = 4500;

/** Resolve a target element: unique match, outside our shadow root, allowed tag. */
function resolveTarget(
  ref: { sectionId?: string; selector?: string },
  widgetRoot: ShadowRoot,
  doc: Document,
): HTMLElement | null {
  let els: NodeListOf<Element> | null = null;
  if (ref.sectionId) {
    els = doc.querySelectorAll(`[id="${cssEscape(ref.sectionId)}"]`);
  } else if (ref.selector) {
    els = doc.querySelectorAll(ref.selector);
    // models often drop the '#' — a bare single token is far more likely an
    // element id than an unknown tag; retry as an id lookup before giving up
    if (els.length === 0 && /^[A-Za-z][\w-]*$/.test(ref.selector.trim())) {
      els = doc.querySelectorAll(`[id="${cssEscape(ref.selector.trim())}"]`);
    }
  } else {
    return null;
  }
  if (!els || els.length !== 1) return null;
  const el = els[0] as HTMLElement;
  if (!(el instanceof HTMLElement)) return null;
  if (widgetRoot.contains(el)) return null; // never act on ourselves
  if (FORBIDDEN_TAGS.has(el.tagName)) return null;
  return el;
}

function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

export function createExecutor(
  getWidgetRoot: () => ShadowRoot | null,
  opts: ExecutorOptions,
  defaults: Partial<ExecutorDefaults> = {},
) {
  const cap = createRateCap();
  let rateWarned = false;

  async function execute(action: Action) {
    if (!opts.enabled()) return; // toggle OFF → silent no-op
    if (!cap.allow(Date.now())) {
      if (!rateWarned) {
        console.warn("[mini-chat] action rate cap exceeded — dropping");
        rateWarned = true;
      }
      return;
    }
    const widgetRoot = getWidgetRoot();
    switch (action.action) {
      case "scrollTo": {
        const el = widgetRoot && resolveTarget(action, widgetRoot, document);
        if (!el) return warnDrop(action);
        gaze(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      case "highlight": {
        const el = widgetRoot && resolveTarget(action, widgetRoot, document);
        if (!el) return warnDrop(action);
        gaze(el);
        // INLINE styles: host-page elements cannot see the widget's shadow-root
        // stylesheet, so an attribute + shadow CSS would be invisible.
        const prev = { outline: el.style.outline, offset: el.style.outlineOffset };
        el.setAttribute("data-mini-highlight", ""); // opt-in hook for host CSS
        el.style.outline = "3px solid #f0b429";
        el.style.outlineOffset = "3px";
        setTimeout(() => {
          el.style.outline = prev.outline;
          el.style.outlineOffset = prev.offset;
          el.removeAttribute("data-mini-highlight");
        }, action.durationMs ?? defaults.highlightMs ?? DEFAULT_HIGHLIGHT_MS);
        return;
      }
      case "navigate": {
        const path = parseNavPath(action.path);
        if (!path) return warnDrop(action);
        const ok = await opts.onNavigate(path);
        if (ok) window.location.assign(path);
        return;
      }
      case "move": {
        opts.onMove(action.near); // movement engine resolves + clamps
        const root = getWidgetRoot();
        if (root) {
          const el = tryResolveNear(action.near, root);
          if (el) gaze(el);
        }
        return;
      }
    }
  }

  function tryResolveNear(near: string, widgetRoot: ShadowRoot): HTMLElement | null {
    const m = near.match(/^(\d+),(\d+)$/); // "x,y" coords — orb itself gazes there
    if (m) return null;
    if (["top-left", "top-right", "bottom-left", "bottom-right"].includes(near)) return null;
    const el = resolveTarget({ selector: near }, widgetRoot, document)
      ?? resolveTarget({ sectionId: near }, widgetRoot, document);
    return el;
  }

  function gaze(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    opts.onGaze({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  function warnDrop(action: Action) {
    console.warn("[mini-chat] action target unresolvable/forbidden — ignored:", action);
  }

  return { execute };
}
