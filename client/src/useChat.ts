import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ExpressionState, PageContext, ServerEvent, StoredSession } from "@shared/types";
import { createActionScanner } from "./actions";
import type { Action } from "@shared/types";
import type { Memory } from "./storage";

// The chat hook (PLAN.md §3.1 `useChat`): SSE client, history, persist,
// expression state, action dispatch, §3.8 error UX. Manual/browser-verified.

export type ErrorKind = "rate" | "budget" | "network" | "stream";

export interface ChatError {
  kind: ErrorKind;
  message: string;
  retry?: () => void;
}

export interface UseChatOptions {
  backendUrl: string;
  agentId: string;
  memory: Memory;
  getPageContext: () => PageContext;
  onAction: (action: Action) => void;
  onExpression?: (expr: ExpressionState) => void;
}

const WATCHDOG_MS = 35_000; // §3.2.2 — silence mid-turn → redial
const DONE_SETTLE_MS = 1_600;

export function useChat(opts: UseChatOptions) {
  const { backendUrl, agentId, memory, getPageContext, onAction } = opts;

  const [history, setHistory] = useState<ChatMessage[]>(() => memory.load()?.history ?? []);
  const [streamText, setStreamText] = useState("");
  const streamRef = useRef(""); // mirror: persist WITHOUT side effects inside updaters
  const [phase, setPhase] = useState<ExpressionState>("idle");
  const [error, setError] = useState<ChatError | null>(null);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<StoredSession | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scannerRef = useRef(createActionScanner());
  const lastEventAt = useRef(Date.now());
  const lastAttempt = useRef<{ before: ChatMessage[]; user: ChatMessage } | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();

  if (!sessionRef.current) {
    const loaded = memory.load();
    sessionRef.current = loaded ?? {
      sessionId: newId(),
      createdAt: Date.now(),
      history: [],
      prefs: {},
    };
    memory.save(sessionRef.current);
  }

  useEffect(() => {
    opts.onExpression?.(phase);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(
    (h: ChatMessage[]) => {
      if (!sessionRef.current) return;
      sessionRef.current = { ...sessionRef.current, history: h };
      memory.save(sessionRef.current);
      setHistory(h);
    },
    [memory],
  );

  // ── SSE lifecycle (§3.2.2) ────────────────────────────────────────────────

  const connect = useCallback((sessionId: string) => {
    esRef.current?.close();
    const es = new EventSource(`${backendUrl}/api/sse?sessionId=${encodeURIComponent(sessionId)}`);
    esRef.current = es;

    es.onopen = () => setReconnecting(false);
    es.onerror = () => setReconnecting(true); // native auto-reconnect handles it
    es.onmessage = (ev) => {
      lastEventAt.current = Date.now();
      let event: ServerEvent;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (event.type === "token") {
        setPhase((p) => (p === "thinking" ? "speaking" : p));
        const out = scannerRef.current.feed(event.value);
        for (const a of out.actions) onAction(a);
        if (out.prose) {
          streamRef.current += out.prose;
          setStreamText(streamRef.current);
        }
      }
      if (event.type === "done") finishTurn();
      if (event.type === "error") {
        const partial = streamRef.current;
        if (partial) {
          // keep the partial reply, allow retry (§3.8)
          persist([...currentHistory(), { role: "assistant", content: partial }]);
        }
        setError({ kind: "stream", message: "Something went wrong finishing that.", retry: retryLast });
        setPhase("idle");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, onAction]);

  function currentHistory(): ChatMessage[] {
    return sessionRef.current?.history ?? [];
  }

  function finishTurn() {
    const fin = scannerRef.current.flush();
    for (const a of fin.actions) onAction(a);
    const finalText = (streamRef.current + fin.prose).trim();
    streamRef.current = "";
    setStreamText("");
    if (finalText) persist([...currentHistory(), { role: "assistant", content: finalText }]);
    setPhase("done");
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setPhase("idle"), DONE_SETTLE_MS);
    lastAttempt.current = null;
  }

  function retryLast() {
    const attempt = lastAttempt.current;
    if (!attempt) return;
    persist([...attempt.before, attempt.user]);
    runTurn(attempt.before, attempt.user);
  }

  // ── watchdog: silence DURING a turn → redial (§3.2.2) ────────────────────

  useEffect(() => {
    const iv = setInterval(() => {
      if ((phase === "thinking" || phase === "speaking") && Date.now() - lastEventAt.current > WATCHDOG_MS) {
        esRef.current?.close();
        if (sessionRef.current) connect(sessionRef.current.sessionId);
        setReconnecting(true);
      }
    }, 5_000);
    return () => clearInterval(iv);
  }, [phase, connect]);

  useEffect(() => {
    connect(sessionRef.current!.sessionId);
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── send (§3.8 error mapping) ────────────────────────────────────────────

  const runTurn = useCallback(
    async (before: ChatMessage[], userMsg: ChatMessage) => {
      setError(null);
      setPhase("thinking");
      lastEventAt.current = Date.now();
      scannerRef.current = createActionScanner();
      try {
        const res = await fetch(`${backendUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionRef.current!.sessionId,
            agentId,
            history: [...before, userMsg],
            pageContext: getPageContext(),
          }),
        });
        if (res.status === 429) {
          setError({ kind: "rate", message: "Slow down a sec — try again in a moment." });
          setPhase("idle");
          return;
        }
        if (res.status === 503) {
          setError({ kind: "budget", message: "The assistant is taking a break for today." });
          setInputDisabled(true); // the only case that disables input (§3.8)
          setPhase("idle");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        // tokens stream in via SSE; done/error finalize there
      } catch {
        setError({
          kind: "network",
          message: "Can't reach the assistant — check your connection.",
          retry: () => {
            persist([...before, userMsg]);
            runTurn(before, userMsg);
          },
        });
        setPhase("idle");
      }
    },
    [agentId, backendUrl, getPageContext, persist],
  );

  const send = useCallback(
    (text: string) => {
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      if (!userMsg.content) return;
      const before = currentHistory();
      lastAttempt.current = { before, user: userMsg };
      persist([...before, userMsg]);
      streamRef.current = "";
      setStreamText("");
      void runTurn(before, userMsg);
    },
    [persist, runTurn],
  );

  const clearChat = useCallback(() => {
    clearTimeout(settleTimer.current);
    const fresh = memory.clearChat();
    sessionRef.current = fresh;
    setHistory([]);
    streamRef.current = "";
    setStreamText("");
    setPhase("idle");
    setError(null);
    connect(fresh.sessionId); // rotated sessionId → fresh stream (§3.2.2)
  }, [connect, memory]);

  return {
    history,
    streamText,
    phase,
    error,
    inputDisabled,
    reconnecting,
    send,
    clearChat,
    dismissError: () => setError(null),
    /** External history sync (storage event from another tab, §3.6). */
    syncFromStorage: () => {
      if (phase === "thinking" || phase === "speaking") return; // don't clobber a live turn
      const loaded = memory.load();
      if (loaded) {
        sessionRef.current = loaded;
        setHistory(loaded.history);
      }
    },
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
