import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Action, ExpressionState, Prefs } from "@shared/types";
import { ChatPanel } from "./chat-ui";
import { Orb } from "./orb";
import { useMovement } from "./movement";
import { createExecutor } from "./actions";
import { createPerception } from "./perception";
import { browserMemory } from "./storage";
import { useChat, type ChatError } from "./useChat";
import cssText from "./styles.css?raw";

// Widget shell (PLAN.md §3.1/§3.8/§9.12): Shadow-DOM mount, config bootstrap
// (init() → MiniChatConfig → data-* → defaults), full wiring of perception,
// memory, chat, actions, movement, expression.

export interface WidgetConfig {
  backendUrl: string;
  agentId: string;
  title: string;
  accentColor: string;
  greetingText?: string;
}

const DEFAULTS: WidgetConfig = {
  backendUrl: "",
  agentId: "default",
  title: "Assistant",
  accentColor: "#6d28d9",
};

/** Config precedence per-setting: init() → MiniChatConfig → data-* → defaults (§3.8). */
function resolveConfig(init?: Partial<WidgetConfig>, dataAttrs?: Record<string, string>): WidgetConfig {
  const fromData = dataAttrs ?? readDataAttrs();
  const globalCfg = (globalThis as { MiniChatConfig?: Partial<WidgetConfig> }).MiniChatConfig;
  const pick = (k: keyof WidgetConfig, ...aliases: string[]): string | undefined => {
    const fromInit = (init as Record<string, string | undefined>)?.[k];
    const fromGlobal = (globalCfg as Record<string, string | undefined> | undefined)?.[k];
    const data = (fromData as Record<string, string>)[k]
      ?? aliases.map((a) => (fromData as Record<string, string>)[a]).find(Boolean);
    return fromInit ?? fromGlobal ?? data ?? undefined;
  };
  return {
    backendUrl: pick("backendUrl") ?? DEFAULTS.backendUrl,
    agentId: pick("agentId") ?? DEFAULTS.agentId,
    title: pick("title") ?? DEFAULTS.title,
    accentColor: pick("accentColor", "accent") ?? DEFAULTS.accentColor,
    greetingText: pick("greetingText", "greeting"),
  };
}

function readDataAttrs(): Record<string, string> {
  const out: Record<string, string> = {};
  // captured at module load (currentScript goes null after)
  const el = (document.currentScript as HTMLScriptElement | null) ?? window.__miniChatScript;
  if (el) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-")) out[attr.name.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = attr.value;
    }
  }
  return out;
}

declare global {
  interface Window {
    __miniChatScript?: HTMLScriptElement;
    MiniChat?: { init: typeof init };
  }
}

// ── the app ─────────────────────────────────────────────────────────────────

function App({ config, greetingText }: { config: WidgetConfig; greetingText: string }) {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState<ExpressionState>("idle");
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null);
  const [confirmNav, setConfirmNav] = useState<{ path: string; resolve: (ok: boolean) => void } | null>(null);
  const [actionsEnabled, setActionsEnabled] = useState(true);
  const orbButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // stable refs the executor reads through (avoids stale closures)
  const actionsEnabledRef = useRef(actionsEnabled);
  actionsEnabledRef.current = actionsEnabled;
  const gazeRef = useRef(setGaze);
  gazeRef.current = setGaze;

  const memory = useRef(browserMemory(config.agentId)).current;
  const perception = useRef(createPerception()).current;

  const savePrefs = useCallback(
    (prefs: Prefs) => {
      const s = memory.load();
      memory.save({
        ...(s ?? { sessionId: "", createdAt: 0, history: [], prefs: {} }),
        prefs: { ...s?.prefs, ...prefs },
      });
    },
    [memory],
  );

  // prefs: action toggle + orb position (§3.6)
  useEffect(() => {
    const prefs = memory.load()?.prefs as Prefs | undefined;
    if (prefs?.actionsEnabled === false) setActionsEnabled(false);
  }, [memory]);

  const movement = useMovement({
    initialHome: memory.load()?.prefs.position,
    onHomeChange: (home) => savePrefs({ position: home }),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const moveNearRef = useRef(movement.moveNear);
  moveNearRef.current = movement.moveNear;

  // Panel placement: measured + clamped so the panel NEVER leaves the viewport
  // (with the orb at the bottom, orbY - 80 alone pushed the panel bottom
  // off-screen). Re-places as the panel grows (streaming) via ResizeObserver.
  const panelWrapRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ left: -9999, top: -9999 });
  const placePanel = useCallback(() => {
    const wrap = panelWrapRef.current;
    if (!wrap) return;
    const panel = (wrap.querySelector(".mc-panel") ?? wrap) as HTMLElement; // panel carries the real size
    const MARGIN = 14;
    const vw = innerWidth;
    // A4: on mobile the on-screen keyboard shrinks visualViewport, not
    // innerHeight — measure against the visual viewport when available.
    const vv = typeof visualViewport !== "undefined" ? visualViewport : null;
    const vh = Math.min(innerHeight, vv ? vv.height + vv.offsetTop : innerHeight);
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    if (w === 0 || h === 0) return; // transiently detached/not laid out — keep last position

    // B5: mobile → bottom sheet: full-width, anchored to the bottom of the
    // viewport, sitting just above the orb
    if (vw <= 640) {
      const left = Math.max(12, (vw - w) / 2);
      const orbTop = movement.pos.y;
      let top = orbTop - h - 12;
      if (top + h > vh - MARGIN) top = vh - MARGIN - h;
      if (top < MARGIN) top = MARGIN;
      setPanelPos({ left, top });
      return;
    }

    const left = Math.max(
      MARGIN,
      Math.min(
        movement.pos.x > vw / 2 ? movement.pos.x - w - MARGIN : movement.pos.x + 64 + MARGIN,
        vw - w - MARGIN,
      ),
    );
    let top = movement.pos.y - 80; // just above the orb's eyeline
    if (top + h > vh - MARGIN) top = vh - MARGIN - h; // clamp bottom into view
    if (top < MARGIN) top = MARGIN;
    setPanelPos({ left, top });
  }, [movement.pos.x, movement.pos.y]);
  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    // late layout safety net: re-place after paint (fonts/flex settle)
    const raf = requestAnimationFrame(() => requestAnimationFrame(placePanel));
    const wrap = panelWrapRef.current;
    // A4: keyboard opens → visualViewport resizes/scrolls → re-place
    const vv = typeof visualViewport !== "undefined" ? visualViewport : null;
    const onVV = () => placePanel();
    vv?.addEventListener("resize", onVV);
    vv?.addEventListener("scroll", onVV);
    // A6: rotate / browser chrome changes while the panel is open
    const onWinResize = () => placePanel();
    addEventListener("resize", onWinResize);
    addEventListener("orientationchange", onWinResize);
    let ro: ResizeObserver | undefined;
    if (wrap && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => placePanel());
      ro.observe(wrap);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      vv?.removeEventListener("resize", onVV);
      vv?.removeEventListener("scroll", onVV);
      removeEventListener("resize", onWinResize);
      removeEventListener("orientationchange", onWinResize);
    };
  }, [open, placePanel]);

  // actions: move is temporary; after "done" the orb returns home (ticket 11)
  const goHomeRef = useRef(movement.goHome);
  goHomeRef.current = movement.goHome;
  useEffect(() => {
    if (expr === "done") {
      const t = setTimeout(() => goHomeRef.current(), DONE_RETURN_MS);
      return () => clearTimeout(t);
    }
  }, [expr]);

  const navResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const executor = useRef(
    createExecutor(
      () => (rootRef.current?.getRootNode() as ShadowRoot | null) ?? null,
      {
        enabled: () => actionsEnabledRef.current,
        onNavigate: (path) =>
          new Promise<boolean>((resolve) => {
            navResolveRef.current = resolve;
            setConfirmNav({ path, resolve: (ok) => { resolve(ok); navResolveRef.current = null; } });
          }),
        onGaze: (target) => gazeRef.current(target),
        onMove: (near) => moveNearRef.current(near),
      },
    ),
  ).current;

  const chat = useChat({
    backendUrl: config.backendUrl,
    agentId: config.agentId,
    memory,
    getPageContext: () => perception.getPageContext(),
    onAction: (a: Action) => void executor.execute(a),
    onExpression: (e) => setExpr(e),
  });

  // multi-tab history sync via the storage event (§3.6)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === `mini-chat:${config.agentId}`) chat.syncFromStorage();
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, [chat.syncFromStorage, config.agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a11y (§3.8): focus the orb when the panel closes; input focuses itself on open; Esc closes
  useEffect(() => {
    if (!open) orbButtonRef.current?.focus();
  }, [open]);

  const onPointerUp = (e: React.PointerEvent) => {
    const result = movement.onPointerUp(e);
    if (result === "click") setOpen((o) => !o);
  };

  // keyboard activation (§3.8): Enter/Space on the button fires a click with
  // detail === 0 — the pointer path above handles mouse clicks (detail ≥ 1)
  const onOrbClick = (e: React.MouseEvent) => {
    if (e.detail === 0) setOpen((o) => !o);
  };

  return (
    <div
      className="mc-root"
      ref={rootRef}
      style={{ ["--mc-accent" as string]: config.accentColor }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <div
        className={`mc-orb-wrap${movement.dragging ? " mc-dragging" : ""}`}
        style={{ transform: `translate(${movement.pos.x}px, ${movement.pos.y}px)` }}
      >
        <div className={movement.bobbing ? "mc-orb-bob" : undefined}>
          <button
            ref={orbButtonRef}
            aria-label={config.title}
            aria-expanded={open}
            onPointerDown={movement.onPointerDown}
            onPointerMove={movement.onPointerMove}
            onPointerUp={onPointerUp}
            onClick={onOrbClick}
            style={{ border: "none", background: "none", padding: 0, cursor: "inherit" }}
          >
            <Orb expr={expr} gaze={gaze} />
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={panelWrapRef}
          style={{ position: "absolute", left: panelPos.left, top: panelPos.top }}
        >
          <ChatPanel
              title={config.title}
              greetingText={greetingText}
              history={chat.history}
              streamText={chat.streamText}
              error={chat.error}
              inputDisabled={chat.inputDisabled}
              reconnecting={chat.reconnecting}
              actionsEnabled={actionsEnabled}
              confirmNavigate={confirmNav}
              onSend={chat.send}
              onClear={chat.clearChat}
              onDismissError={chat.dismissError}
              onToggleActions={(on) => {
                setActionsEnabled(on);
                savePrefs({ actionsEnabled: on });
              }}
              onNavigateAnswer={(ok) => {
                confirmNav?.resolve(ok);
                setConfirmNav(null);
              }}
              onClose={() => setOpen(false)}
            />
          </div>
      )}
    </div>
  );
}

const DONE_RETURN_MS = 2_200;

// ── mount / init (§9.12) ────────────────────────────────────────────────────

let mounted = false;

export function init(userConfig?: Partial<WidgetConfig>): void {
  if (mounted) return;
  const dataAttrs = readDataAttrs();
  const config = resolveConfig(userConfig, dataAttrs);
  if (!config.backendUrl) {
    console.warn("[mini-chat] no backendUrl — pass it to MiniChat.init, MiniChatConfig, or data-backend-url");
    return;
  }
  mounted = true;

  const host = document.createElement("div");
  host.id = "mini-chat-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;
  shadow.appendChild(style);

  createRoot(shadow).render(<Boot config={config} />);
}

/** Greeting precedence: embed config → server /api/config → default (§3.2.1/§3.8). */
function Boot({ config }: { config: WidgetConfig }) {
  const [greeting, setGreeting] = useState(config.greetingText ?? "");
  useEffect(() => {
    if (config.greetingText) return; // embed config wins
    let alive = true;
    fetch(`${config.backendUrl}/api/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (alive && cfg?.greetingText) setGreeting(cfg.greetingText);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [config.backendUrl, config.greetingText]);
  const greetingText = greeting || "Hi! I'm the site assistant — ask me anything.";
  return <App config={config} greetingText={greetingText} />;
}

// auto-mount: script tag with config OR window.MiniChatConfig (§9.12)
window.__miniChatScript = document.currentScript as HTMLScriptElement | undefined;
window.MiniChat = { init };
if (typeof window !== "undefined") {
  const hasData = document.currentScript?.dataset.backendUrl;
  if (hasData || (globalThis as { MiniChatConfig?: unknown }).MiniChatConfig) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }
}
