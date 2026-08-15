import { useEffect, useRef, useState } from "react";
import type { ExpressionState } from "@shared/types";

// The orb (PLAN.md §3.5, ticket 11): 4-state lifecycle + a separate gaze axis.
// Expression logic lifted from the validated prototype (prototypes/orb.html).

export interface GazeTarget {
  x: number;
  y: number;
}

const MOUTHS: Record<Exclude<ExpressionState, "speaking">, string> = {
  idle: "M25 42 Q32 46 39 42",
  thinking: "M26 43 Q32 43.5 38 43",
  done: "M24 41 Q32 48 40 41",
};

const SPEAK_MOUTHS = [
  "M27 43 Q32 45 37 43",
  "M27 42 Q32 48 37 42",
  "M27 43 Q32 46.5 37 43",
  "M27 42 Q32 49 37 42",
];

export function Orb(props: {
  expr: ExpressionState;
  gaze: GazeTarget | null;
  size?: number;
}) {
  const { expr, gaze, size = 64 } = props;
  const [mouth, setMouth] = useState(MOUTHS.idle);
  const rootRef = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    measure();
    const iv = setInterval(measure, 500); // cheap: gaze needs our viewport pos
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (expr !== "speaking") {
      setMouth(MOUTHS[expr]);
      return;
    }
    let i = 0;
    const iv = setInterval(() => setMouth(SPEAK_MOUTHS[i++ % SPEAK_MOUTHS.length]), 120);
    return () => clearInterval(iv);
  }, [expr]);

  // gaze axis: pupils translate toward the target, clamped to the socket.
  // thinking with no target → the curious up-left glance.
  let ox = 0;
  let oy = 0;
  if (gaze) {
    const dx = gaze.x - center.x;
    const dy = gaze.y - center.y;
    const d = Math.hypot(dx, dy) || 1;
    ox = (dx / d) * 3.2;
    oy = (dy / d) * 3.2;
  } else if (expr === "thinking") {
    ox = -1.6;
    oy = -2.2;
  }

  return (
    <div ref={rootRef} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r="30"
          fill={expr === "thinking" ? "#8a5cf6" : "var(--mc-accent, #6d28d9)"}
        />
        <ellipse cx="24" cy="29" rx="7" ry="8" fill="#fff" />
        <ellipse cx="40" cy="29" rx="7" ry="8" fill="#fff" />
        <circle cx="24" cy="30" r="3.4" fill="#1c1b22" transform={`translate(${ox} ${oy})`} />
        <circle cx="40" cy="30" r="3.4" fill="#1c1b22" transform={`translate(${ox} ${oy})`} />
        <path
          d={mouth}
          stroke="#1c1b22"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d .12s" }}
        />
      </svg>
    </div>
  );
}
