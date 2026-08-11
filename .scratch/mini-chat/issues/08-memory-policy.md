# Memory policy

Type: grilling
Status: resolved

## Question

Decide the localStorage memory policy precisely. Sub-questions:

- **Rolling-cap precedence.** When both the ~100-message and ~100KB caps exist,
  which wins, and what's dropped (oldest)? Is the system message ever stored
  (no — the backend injects it)?
- **`prefs` schema.** What's stored — the action toggle? accent/title? last-open
  state?
- **Multi-tab write conflicts.** Two tabs both chatting and persisting — what's
  the merge / last-write-wins policy given the `storage` event? (The live stream
  now fans out to all tabs — ticket 05 — so this is purely about *persisted*
  history conflicts, not stream ownership.)
- **Validation & fallback.** Corrupt-JSON recovery; in-memory fallback when
  storage is disabled (private mode).
- **"Clear chat" semantics.** Wipes history + `sessionId` + `prefs`, or just
  history?

PLAN ref: §3.6.

> **Cross-ref (from [ticket 04](./04-action-pipeline-ownership.md)):** persisted history should store **cleaned prose** (action fences stripped), not the raw streamed buffer — decide how cleaning happens (client strips its buffer, or uses the final `message` ServerEvent; coordinate with ticket 10).

> **Cross-ref (raised during ticket 07):** add a **widget `position` pref** (corner or x/y) so a user-dragged orb position persists across reloads (coordinate with ticket 11).

## Answer

Decisions (locked for the spec):

1. **Rolling cap** — enforce **both** ≤100 messages and ≤100 KB; when either trips, drop the **oldest** user/assistant turns first until under both. **System message never stored** (backend injects it).
2. **`prefs` schema** — `{ actionsEnabled: boolean (default true), position?: corner | {x,y} }` only. Accent/title come from embed config (not prefs); open/closed state not persisted (panel starts collapsed).
3. **Multi-tab writes** — **last-write-wins** (rare conflict only when chatting in two tabs at once; the `storage` event syncs the non-writing tab).
4. **Cleaned-prose persistence** — the client persists its **own cleaned render-buffer prose** (action fences already stripped by the scanner, §3.4/§3.7). No reliance on a server `message` event → resolves ticket 10's open question (`message` ServerEvent is redundant for persistence).
5. **Validation & fallback** — validate-on-load, **reset to empty** if corrupt (+ `console.warn`, never crash); try/catch all storage ops → **in-memory fallback** when storage is disabled (private mode).
6. **"Clear chat"** — wipes `history` + **rotates a fresh `sessionId`**; **`prefs` survive**.

`PLAN.md` §3.6 updated. Cross-ref: [10](./10-wire-protocol-semantics.md) (`message` ServerEvent redundant for persistence — resolved).
