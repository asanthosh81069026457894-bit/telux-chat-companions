// Shared state for the /dashboard workspace + /talk transcript.
//
// Why this module exists:
//   - Chat history and talk transcript were each held in local component
//     state. Switching Documents ↔ Chat ↔ Talk remounted those components
//     and wiped the messages.
//   - The user wants the conversation history to persist as they move
//     between features in a single session and across page reloads, so
//     the panels can hold multi-turn context without losing turns when
//     the user clicks around the app.
//
// Why two layers:
//   - `chatMessages` is exposed as a module-level external store
//     **backed by localStorage** via `useChatMessages()`. The chat
//     panel lives inside /dashboard, but the user navigates away
//     (Documents ↔ Chat) and back frequently; a Provider was
//     destroyed on unmount, wiping the conversation. Module-level
//     state survives navigation, and a localStorage mirror survives
//     hard reloads so the user can pick up the conversation tomorrow.
//   - `talkMessages` is exposed as a module-level external store via
//     `useTalkMessages()`. The /talk route is a separate page, and the
//     DashboardStateProvider unmounts when the user navigates away from
//     `/dashboard`. The external store survives that navigation so the
//     rolling transcript is preserved when the user comes back. /talk
//     is intentionally session-only (a page reload clears it) — the
//     feature is a live voice workspace, not a Claude-style chat log.
//
// The external stores use React's `useSyncExternalStore` so any
// component reading the messages re-renders when the list grows. No
// external state library is needed — two plain arrays + one
// subscription mechanism + optional localStorage mirror.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// --- Shared message shape -----------------------------------------------------

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  feedback?: "up" | "down" | null;
};

// `talkMessages` reuses the same shape so the panel components can be
// used without per-feature typing.
export type Message = ChatMessage;

// --- External store for /talk messages (module-level, session-only) ----------

let talkMessages: ChatMessage[] = [];
const talkListeners = new Set<() => void>();

function emitTalk(): void {
  for (const fn of talkListeners) fn();
}

function subscribeTalk(listener: () => void): () => void {
  talkListeners.add(listener);
  return () => {
    talkListeners.delete(listener);
  };
}

function getTalkSnapshot(): ChatMessage[] {
  return talkMessages;
}

// React's `useSyncExternalStore` requires a server snapshot that's
// referentially stable. Returning the same empty array each time keeps
// SSR happy and avoids hydration mismatches.
const EMPTY_SNAPSHOT: ChatMessage[] = [];
function getTalkServerSnapshot(): ChatMessage[] {
  return EMPTY_SNAPSHOT;
}

/**
 * Read/write the talk-with-document transcript. Survives navigation away
 * from /talk because the store is module-level (not React-state). Lives
 * only in memory; a page reload clears it (the rolling transcript is
 * ephemeral by design — /talk is ephemeral by design).
 */
export function useTalkMessages(): {
  messages: ChatMessage[];
  setMessages: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
} {
  const snapshot = useSyncExternalStore(subscribeTalk, getTalkSnapshot, getTalkServerSnapshot);
  // Wrap setState so callers can pass either a new array or an updater fn.
  // The wrapper runs the updater against the freshest snapshot, not the
  // one captured in a closure — same trick the chat panel already uses.
  const setMessages = useCallback(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      talkMessages =
        typeof next === "function"
          ? (next as (p: ChatMessage[]) => ChatMessage[])(talkMessages)
          : next;
      emitTalk();
    },
    [],
  );
  return { messages: snapshot, setMessages };
}

/** Clear the talk transcript (used by future "Clear conversation" buttons). */
export function clearTalkMessages(): void {
  talkMessages = [];
  emitTalk();
}

// --- External store for chat messages (module-level + localStorage) ----------
//
// The chat panel lives inside /dashboard. The user navigates away
// (Documents ↔ Chat) and back frequently; an in-context store
// was destroyed on unmount, wiping the conversation. Module-level state
// survives navigation, and a localStorage mirror survives hard reloads
// so the user can pick up the conversation tomorrow.
//
// Schema-versioned key (`-v1`) so we can bump the suffix when the
// message shape changes — old data is silently ignored without writing
// a migration. Bounded by `CHAT_MAX_MESSAGES` so the entry can't grow
// without bound; oldest turns are dropped on overflow.

const CHAT_STORAGE_KEY = "telux:chat-history-v1";
const CHAT_MAX_MESSAGES = 200; // hard cap so the entry can't grow without bound

let chatMessages: ChatMessage[] = loadChatFromStorage();
const chatListeners = new Set<() => void>();

function loadChatFromStorage(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: only keep messages that have the shape we expect.
    // Stale/foreign data is silently dropped so the UI never crashes
    // on a malformed entry.
    return parsed.filter(
      (m): m is ChatMessage =>
        m &&
        typeof m === "object" &&
        typeof m.id === "string" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.text === "string",
    );
  } catch {
    // localStorage can throw in private mode, on quota-exceeded, or when
    // the JSON is corrupt. None of those are recoverable here — fall
    // back to an empty conversation rather than blank the page.
    return [];
  }
}

function persistChat(next: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    // Cap the tail so the storage entry can't grow without bound.
    // Older turns are dropped on overflow — the most recent context is
    // what the model needs anyway.
    const slice = next.length > CHAT_MAX_MESSAGES ? next.slice(-CHAT_MAX_MESSAGES) : next;
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(slice));
  } catch {
    // Quota / private mode / disabled storage — silent fallback. The
    // in-memory store still works for the current session.
  }
}

function emitChat(): void {
  for (const fn of chatListeners) fn();
}

function subscribeChat(listener: () => void): () => void {
  chatListeners.add(listener);
  return () => {
    chatListeners.delete(listener);
  };
}

function getChatSnapshot(): ChatMessage[] {
  return chatMessages;
}

function getChatServerSnapshot(): ChatMessage[] {
  return EMPTY_SNAPSHOT;
}

/**
 * Read/write the chat panel history. Persists across page reloads via
 * `localStorage["telux:chat-history-v1"]`. Survives navigation between
 * Documents and Chat inside `/dashboard` because the store is
 * module-level, not context-bound (the Provider used to unmount on
 * tab flips and wipe the conversation).
 */
export function useChatMessages(): {
  messages: ChatMessage[];
  setMessages: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
} {
  const snapshot = useSyncExternalStore(subscribeChat, getChatSnapshot, getChatServerSnapshot);
  const setMessages = useCallback(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      chatMessages =
        typeof next === "function"
          ? (next as (p: ChatMessage[]) => ChatMessage[])(chatMessages)
          : next;
      persistChat(chatMessages);
      emitChat();
    },
    [],
  );
  return { messages: snapshot, setMessages };
}

/** Wipe the chat panel history (used by the future "Clear conversation" button). */
export function clearChatMessages(): void {
  chatMessages = [];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // ignore — localStorage might be disabled
    }
  }
  emitChat();
}

// --- Dashboard context --------------------------------------------------------
//
// Kept as a thin marker provider around `DashboardPage` for any future
// dashboard-only shared state. The chat message store has been promoted
// to a module-level external store above (`useChatMessages`), so this
// provider no longer carries message data.

type DashboardStateValue = Record<string, never>;

const DashboardStateContext = createContext<DashboardStateValue | null>(null);

/**
 * Provider mounted around `DashboardPage`. Children must be inside the
 * `/dashboard` route — outside the provider the hook throws.
 */
export function DashboardStateProvider({ children }: { children: ReactNode }) {
  // Intentionally empty: chat messages moved to `useChatMessages()` (a
  // module-level external store with localStorage backing). The provider
  // remains so any dashboard-only shared state added later has a home.
  const value = useMemo<DashboardStateValue>(() => ({}), []);
  return <DashboardStateContext.Provider value={value}>{children}</DashboardStateContext.Provider>;
}

export function useDashboardState(): DashboardStateValue {
  const ctx = useContext(DashboardStateContext);
  if (!ctx) {
    throw new Error("useDashboardState must be used inside a <DashboardStateProvider />.");
  }
  return ctx;
}
