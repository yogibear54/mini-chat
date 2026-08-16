import { useCallback, useEffect, useRef, useState } from "react";
import type { Prefs } from "@shared/types";

// Movement engine (PLAN.md §3.5, ticket 11): glide on an outer transform,
// idle bob on an inner element, viewport clamping, user drag with a 4px
// drag-vs-click threshold. Pure math lifted from the validated prototype.

const MARGIN = 14;
const DRAG_THRESHOLD = 4;

export interface Pos {
  x: number;
  y: number;
}

function clampToViewport(pos: Pos, vw = innerWidth, vh = innerHeight): Pos {
  return {
    x: Math.max(MARGIN, Math.min(pos.x, vw - orbSize() - MARGIN)),
    y: Math.max(MARGIN, Math.min(pos.y, vh - orbSize() - MARGIN)),
  };
}

function orbSize(): number {
  return 64;
}

function cornerPos(corner: string): Pos {
  const vw = innerWidth;
  const vh = innerHeight;
  const s = orbSize();
  const base: Record<string, Pos> = {
    "top-left": { x: MARGIN, y: MARGIN },
    "top-right": { x: vw - s - MARGIN, y: MARGIN },
    "bottom-left": { x: MARGIN, y: vh - s - MARGIN },
    "bottom-right": { x: vw - s - MARGIN, y: vh - s - MARGIN },
  };
  return base[corner] ?? base["bottom-right"];
}

/** Adjacent, not overlapping: below if there's room, else above. */
function adjacentTo(rect: DOMRect): Pos {
  const s = orbSize();
  const belowFits = rect.bottom + MARGIN + s <= innerHeight - MARGIN;
  return clampToViewport({
    x: rect.left + rect.width / 2 - s / 2,
    y: belowFits ? rect.bottom + MARGIN : rect.top - s - MARGIN,
  });
}

export function resolveNear(near: string): Pos {
  const coords = near.match(/^(\d+),(\d+)$/);
  if (coords) return clampToViewport({ x: Number(coords[1]), y: Number(coords[2]) });
  if (["top-left", "top-right", "bottom-left", "bottom-right"].includes(near)) {
    return cornerPos(near);
  }
  const el =
    document.getElementById(near) ??
    document.querySelector(near); // treat as selector (guarded upstream)
  if (el) return adjacentTo(el.getBoundingClientRect());
  console.warn("[mini-chat] move target unresolvable — returning to home corner:", near);
  return cornerPos("bottom-right");
}

export interface MovementOptions {
  initialHome?: Prefs["position"];
  onHomeChange: (home: Pos) => void; // persists the position pref (§3.6)
  reducedMotion: boolean;
}

export function useMovement(opts: MovementOptions) {
  const homeRef = useRef<Pos>(
    typeof opts.initialHome === "object" && opts.initialHome
      ? clampToViewport(opts.initialHome)
      : cornerPos("bottom-right"),
  );
  const [pos, setPos] = useState<Pos>(homeRef.current);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; pos0: Pos; moved: number; acted: boolean } | null>(null);

  // re-clamp on resize / orientation change
  useEffect(() => {
    const onResize = () => {
      homeRef.current = clampToViewport(homeRef.current);
      setPos((p) => clampToViewport(p));
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  const moveNear = useCallback((near: string) => {
    setPos(resolveNear(near)); // temporary — home unchanged (ticket 11)
  }, []);

  const goHome = useCallback(() => {
    setPos(homeRef.current);
  }, []);

  // pointer handlers: <4px = click (caller opens panel), ≥4px = drag (moves home)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, pos0: posRef.current, moved: 0, acted: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const posRef = useRef(pos);
  posRef.current = pos;

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      d.moved = Math.max(d.moved, Math.hypot(dx, dy));
      if (d.moved >= DRAG_THRESHOLD) {
        d.acted = true;
        setDragging(true);
        setPos(clampToViewport({ x: d.pos0.x + dx, y: d.pos0.y + dy }));
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent): "click" | "drag" | null => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d) return null;
      if (!d.acted) return "click"; // under threshold → it was a click
      const p = clampToViewport(posRef.current);
      homeRef.current = p; // the user's dragged spot becomes home (§3.5)
      opts.onHomeChange(p);
      return "drag";
    },
    [opts], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    pos,
    dragging,
    bobbing: !dragging,
    moveNear,
    goHome,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
