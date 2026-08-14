# Orb expression & movement engine

Type: prototype
Status: resolved

## Question

Raise fidelity on the orb/movement design with a cheap, throwaway prototype (per
the `/prototype` skill) so we can react to behavior rather than guess. Produce a
prototype demonstrating:

- **Expression state machine** — states (`idle`, `thinking`, `speaking`,
  `looking`, `done`), what triggers each transition, transition timing.
- **Eye orientation** — math for aiming eyes at an action target's screen
  position; behavior when the target is off-screen.
- **Movement** — default corner/position; glide easing + duration; an idle bob
  that doesn't fight the position transform; **viewport-edge clamping** so it
  never leaves the screen; mobile / small-viewport behavior.
- **Panel open/close animation.**

Link the prototype as an asset. The decision records the **chosen state machine
+ positioning constraints** (the correctness-critical parts); pure aesthetics
(amplitudes, easing curves, colors) stay implementer-discretion per the map's
Out-of-scope line.

PLAN ref: §3.5.

> **Added requirement (raised during ticket 07):** the widget/orb must be **user-draggable** so it can be moved out of the way if it blocks content. Decisions to make here: drag-vs-click disambiguation (a move threshold, so a click to open the panel isn't read as a drag); the dragged **position persists** across reloads (a `position` pref — coordinate with ticket 08); dragging respects viewport clamping (can't be flung off-screen); and how a manual drag interacts with the `move` action (does a `move` action override the spot the user chose?).

## Answer

Resolved by throwaway prototype: [prototypes/orb.html](../prototypes/orb.html) (double-click to run; the pure `reduce` + positioning helpers at the bottom are the liftable bit). The user drove it and signed off ("sounds good"), with two fixes folded in en route: the `thinking` face was a frown (now neutral + an up-left glance) and the `speaking` mouth is now animated (flutters; syncs to token arrival in the real widget).

Locked for the spec:

**Expression — 4-state lifecycle + a separate gaze axis:**
- `idle` → `thinking` → `speaking` → `done` → `idle`. (`thinking` = curious/neutral, `speaking` = animated talking mouth, `done` = pleased/big smile, `idle` = calm smile + bob.)
- **Gaze is a separate axis, NOT a 5th "looking" state** — eyes track the action target during any state (pupils → target, clamped to socket; off-screen clamps to direction). Chosen over making "looking" sequential.
- Personality: calm helper. (Amplitudes/shapes/easing/colors → implementer discretion.)

**Movement & positioning:**
- Glide on an outer `transform` wrapper (~0.5 s); idle bob on a separate inner element (no transform fight).
- **Viewport clamping**: 14 px margin all edges; never off-screen; re-clamp on resize.
- **User-draggable** (ticket 07): **4 px threshold** — under = click (toggle panel), over = drag (move + update `home`, suppress click). Confirmed.
- **`move` vs user spot**: `move` glides adjacent to the target (below/above, non-overlapping), temporary; after `done` the orb **returns to `home`** (default ON; stay-put rejected as default).
- Mobile: orb re-clamps; panel goes near-full-width.

`PLAN.md` §3.5 rewritten; §2 "Body" row updated (`looking` is no longer a state). Prototype kept as the linked asset.
