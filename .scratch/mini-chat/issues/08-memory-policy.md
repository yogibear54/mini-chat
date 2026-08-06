# Memory policy

Type: grilling
Status: open

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
