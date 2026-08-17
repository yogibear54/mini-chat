import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ChatMessage } from "@shared/types";
import type { ChatError } from "./useChat";

// Panel UI (PLAN.md §3.7/§3.8): safe markdown, streaming bubble, error UX,
// navigate-confirm bar, action toggle. All inside the Shadow DOM.

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "tel"], // http/https/mailto defaults + tel
  },
};

function Markdown({ children }: { children: string }) {
  return (
    <div className="mc-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function ChatPanel(props: {
  title: string;
  greetingText: string;
  history: ChatMessage[];
  streamText: string;
  error: ChatError | null;
  inputDisabled: boolean;
  reconnecting: boolean;
  actionsEnabled: boolean;
  confirmNavigate: { path: string; resolve: (ok: boolean) => void } | null;
  onSend: (text: string) => void;
  onClear: () => void;
  onDismissError: () => void;
  onToggleActions: (on: boolean) => void;
  onNavigateAnswer: (ok: boolean) => void;
  onClose: () => void;
}) {
  const {
    title, greetingText, history, streamText, error, inputDisabled, reconnecting,
    actionsEnabled, confirmNavigate, onSend, onClear, onDismissError,
    onToggleActions, onNavigateAnswer, onClose,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll the message window to the bottom on new content — but only
  // if the user was already at (or near) the bottom BEFORE this update. If
  // they scrolled up to read history, leave them alone. We track "was at
  // bottom" via an onScroll ref because by the time the effect runs (after
  // commit), scrollHeight has already grown and the naive distFromBottom
  // check would always drift past the threshold.
  const messagesRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !wasAtBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [history, streamText]);
  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // focus management: panel opens → the user can type immediately (§3.8)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mc-panel" role="dialog" aria-label={title}>
      <header className="mc-header">
        <strong>{title}</strong>
        <div className="mc-header-actions">
          <label className="mc-toggle" title="Let the assistant act on the page">
            <input
              type="checkbox"
              checked={actionsEnabled}
              onChange={(e) => onToggleActions(e.target.checked)}
              aria-label="Allow page actions"
            />
            actions
          </label>
          <button onClick={onClear} aria-label="Clear chat">clear</button>
          <button onClick={onClose} aria-label="Close chat">×</button>
        </div>
      </header>

      <div className="mc-messages" aria-live="polite" aria-relevant="additions" ref={messagesRef} onScroll={onMessagesScroll}>
        {history.length === 0 && !streamText && (
          <div className="mc-msg mc-assistant"><Markdown>{greetingText}</Markdown></div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`mc-msg ${m.role === "user" ? "mc-user" : "mc-assistant"}`}>
            <Markdown>{m.content}</Markdown>
          </div>
        ))}
        {streamText && (
          <div className="mc-msg mc-assistant mc-streaming">
            <Markdown>{streamText}</Markdown>
          </div>
        )}
      </div>

      {confirmNavigate && (
        <div className="mc-confirm" role="alertdialog" aria-label="Confirm navigation">
          <span>Assistant wants to take you to <code>{confirmNavigate.path}</code></span>
          <div>
            <button className="mc-primary" onClick={() => onNavigateAnswer(true)}>Let's go</button>
            <button onClick={() => onNavigateAnswer(false)}>Not now</button>
          </div>
        </div>
      )}

      {error && (
        <div className="mc-error" role="alert">
          <span>{error.message}</span>
          <div>
            {error.retry && <button onClick={error.retry}>Retry</button>}
            <button onClick={onDismissError} aria-label="Dismiss">×</button>
          </div>
        </div>
      )}

      {reconnecting && <div className="mc-status">reconnecting…</div>}

      <form
        className="mc-input"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("m") as HTMLInputElement);
          if (input.value.trim()) {
            onSend(input.value);
            input.value = "";
          }
        }}
      >
        <input
          ref={inputRef}
          name="m"
          placeholder="Ask me anything…"
          disabled={inputDisabled}
          aria-label="Message"
        />
        <button type="submit" disabled={inputDisabled}>send</button>
      </form>
    </div>
  );
}
