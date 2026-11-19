import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ApiError, fetchChatEnabled, sendChatMessage, useRemote } from '../api';
import { formatMileage, formatPrice } from '../format';
import type { NavState } from '../navigation';
import type { ChatVehicle } from '../types';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  vehicles?: ChatVehicle[];
  error?: boolean;
}

const GREETING: Message = {
  role: 'assistant',
  text: "Hi! I can help you find a vehicle. Tell me what you're looking for: body style, budget, new or used.",
};
const SUGGESTIONS = ['SUVs under $40,000', 'What electric cars do you have?', 'Cheapest used truck'];
const MAX_LENGTH = 1000; // CHAT_MESSAGE_MAX_LENGTH in server/chat.ts
const STORAGE_KEY = 'vehicle-chat';

// Pages for customers; the chat stays out of the way on sign-in and admin screens.
const HIDDEN = [/^\/login/, /^\/forgot-password/, /^\/reset-password/, /^\/account\//, /^\/dashboard/, /^\/leads/,/^\/vehicles\/new$/, /\/edit$/];

/** closed: just the launcher button; minimized: a title bar; open: the full chat (optionally maximized). */
type Mode = 'closed' | 'minimized' | 'open';

interface Saved {
  mode: Mode;
  maximized: boolean;
  /** A reply arrived while the chat was minimized or closed. */
  unread: boolean;
  conversationId?: string;
  messages: Message[];
}

const FRESH: Saved = { mode: 'closed', maximized: false, unread: false, messages: [GREETING] };

// sessionStorage is a convenience (survives navigation and reloads); everything works without it.
function load(): Saved {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as (Partial<Saved> & { open?: boolean }) | null;
    if (saved && Array.isArray(saved.messages)) {
      const mode: Mode = saved.mode ?? (saved.open ? 'open' : 'closed'); // `open` was the earlier format
      return { ...FRESH, ...saved, mode, messages: saved.messages };
    }
  } catch { /* unavailable or corrupt */ }
  return FRESH;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  minimize: 'M3.5 12h9',
  maximize: 'M3 3h10v10H3z',
  restore: 'M5.5 3h7.5v7.5M3 5.5h7.5V13H3z',
  close: 'M4 4l8 8M12 4l-8 8',
  restart: 'M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5',
  expand: 'M4 10l4-4 4 4',
};

/** Floating "Ask our assistant" chat, answered by the Foundry agent through `POST /api/chat`. */
export function ChatWidget() {
  const location = useLocation();
  const enabled = useRemote('chat-status', (signal) => fetchChatEnabled(signal));
  const [state, setState] = useState<Saved>(load);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages, sending, state.mode, state.maximized]);

  useEffect(() => {
    if (state.mode === 'open') inputRef.current?.focus();
  }, [state.mode]);

  if (enabled.status !== 'ready' || !enabled.data || HIDDEN.some((re) => re.test(location.pathname))) return null;

  const setMode = (mode: Mode) => setState((s) => ({ ...s, mode, unread: mode === 'open' ? false : s.unread }));
  const toggleMaximized = () => setState((s) => ({ ...s, maximized: !s.maximized }));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setDraft('');
    setSending(true);
    setState((s) => ({ ...s, messages: [...s.messages, { role: 'user', text: message }] }));
    try {
      const reply = await sendChatMessage(message, state.conversationId);
      setState((s) => ({
        ...s,
        conversationId: reply.conversationId,
        unread: s.mode !== 'open',
        messages: [...s.messages, { role: 'assistant', text: reply.reply, vehicles: reply.vehicles }],
      }));
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'Could not reach the assistant. Check your connection and try again.';
      setState((s) => ({ ...s, unread: s.mode !== 'open', messages: [...s.messages, { role: 'assistant', text, error: true }] }));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  // Enter sends, Shift+Enter adds a line.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const restart = () => setState((s) => ({ ...FRESH, mode: 'open', maximized: s.maximized }));

  if (state.mode === 'closed') {
    return (
      <button type="button" className="chat-launcher" onClick={() => setMode('open')} aria-label="Open chat assistant">
        <span aria-hidden="true">💬</span> Ask our assistant
        {state.unread && <span className="chat-unread" title="New reply"><span className="visually-hidden">New reply</span></span>}
      </button>
    );
  }

  const closeButton = (
    <button type="button" className="chat-icon" onClick={() => setMode('closed')} title="Close" aria-label="Close chat">
      <Icon d={ICONS.close} />
    </button>
  );

  if (state.mode === 'minimized') {
    return (
      <section className="chat-bar" aria-label="Chat assistant (minimized)">
        <button type="button" className="chat-bar-main" onClick={() => setMode('open')} aria-label="Restore chat">
          <span className="chat-title">Vehicle assistant</span>
          {state.unread ? <span className="chat-bar-note">New reply</span> : sending && <span className="chat-bar-note">Typing…</span>}
        </button>
        <button type="button" className="chat-icon" onClick={() => setMode('open')} title="Restore" aria-label="Restore chat">
          <Icon d={ICONS.expand} />
        </button>
        {closeButton}
      </section>
    );
  }

  const from = { from: location.pathname + location.search } satisfies NavState;
  const onlyGreeting = state.messages.length === 1;

  return (
    <section
      className={state.maximized ? 'chat chat-max' : 'chat'}
      aria-label="Chat assistant"
      onKeyDown={(e) => {
        // Esc shrinks a maximized chat, otherwise minimizes it.
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (state.maximized) toggleMaximized();
        else setMode('minimized');
      }}
    >
      <header className="chat-head" onDoubleClick={toggleMaximized}>
        <div>
          <p className="chat-title">Vehicle assistant</p>
          <p className="chat-sub">Answers come from our live inventory</p>
        </div>
        <div className="chat-head-actions">
          {!onlyGreeting && (
            <button type="button" className="chat-icon" onClick={restart} title="Start over" aria-label="Start a new conversation">
              <Icon d={ICONS.restart} />
            </button>
          )}
          <button type="button" className="chat-icon" onClick={() => setMode('minimized')} title="Minimize" aria-label="Minimize chat">
            <Icon d={ICONS.minimize} />
          </button>
          <button
            type="button"
            className="chat-icon chat-max-toggle"
            onClick={toggleMaximized}
            title={state.maximized ? 'Restore size' : 'Maximize'}
            aria-label={state.maximized ? 'Restore chat size' : 'Maximize chat'}
            aria-pressed={state.maximized}
          >
            <Icon d={state.maximized ? ICONS.restore : ICONS.maximize} />
          </button>
          {closeButton}
        </div>
      </header>

      <ol className="chat-log" ref={listRef} aria-live="polite">
        {state.messages.map((m, i) => (
          <li key={i} className={`chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}`}>
            {/* Plain text only: the reply comes from a model, so it's never rendered as HTML. */}
            <p className="chat-text">{m.text}</p>
            {m.vehicles && m.vehicles.length > 0 && (
              <ul className="chat-vehicles">
                {m.vehicles.map((v) => (
                  <li key={v.id}>
                    <Link to={`/vehicles/${v.id}`} state={from} className="chat-vehicle">
                      <span className="chat-vehicle-name">{v.year} {v.name} {v.model}</span>
                      <span className="chat-vehicle-meta">
                        <strong>{formatPrice(v.price)}</strong> · {formatMileage(v.mileage)} · {v.condition}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {sending && (
          <li className="chat-msg chat-assistant chat-typing" role="status">
            <span className="visually-hidden">The assistant is typing</span>
            <span className="dot" /><span className="dot" /><span className="dot" />
          </li>
        )}
      </ol>

      {onlyGreeting && (
        <div className="chat-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chat-chip" onClick={() => void send(s)} disabled={sending}>{s}</button>
          ))}
        </div>
      )}

      <form className="chat-form" onSubmit={onSubmit}>
        <label htmlFor="chat-input" className="visually-hidden">Message</label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder="Ask about our vehicles…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="button chat-send" disabled={sending || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
