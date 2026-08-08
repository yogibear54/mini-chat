# Orb expression & movement engine

Type: prototype
Status: open

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
