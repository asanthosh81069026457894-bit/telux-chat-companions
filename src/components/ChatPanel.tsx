// ChatPanel — document-aware chatbot that lives in /dashboard.
//
// History is sourced from `useChatMessages()` (a module-level external
// store backed by `localStorage["telux:chat-history-v1"]`) instead of
// local `useState`, so the conversation survives:
//   - tab switches between Documents and Chat within a session,
//   - hard page reloads (the user can pick up the chat tomorrow).
// Refs mirror the latest messages so the Regenerate handler (called from
// inside the message map) sees a fresh snapshot, not a stale closure.
//
// What stays local:
//   - `input`, `pending`, `scrolledUp`, `scrolledDown`, `justDictated`,
//     `sttLang` — pure UI state that's irrelevant once the user leaves
//     the panel.
//   - The same pattern as the original (extracted) panel; only the
//     `messages` array moved.

import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  LoaderCircle,
  Mic,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useChatMessages, type ChatMessage } from "@/components/dashboard-state";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useAuth } from "@/hooks/useAuth";
import type { useDocuments } from "@/hooks/useDocuments";
import { useSpeech } from "@/hooks/useSpeech";
import { useUsage } from "@/hooks/useUsage";
import { DEFAULT_LANG, nativeForLang, useVoices } from "@/hooks/useVoices";
import { askChat, ChatRateLimitedError } from "@/lib/chat";
import { bilingualPlaceholder, lookupChatCopy } from "@/lib/chat-i18n";
import { allChunks } from "@/lib/documents";
import { detectLangFromDocs } from "@/lib/detect-lang";
import { scoreChunks } from "@/lib/scoring";
import { canAsk, canUseVoice, recordQuestion } from "@/lib/usage";

const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    role: "assistant",
    text: "Hi! Upload a document on the left and I'll help you summarize, search, or ask questions about it.",
  },
];

export function ChatPanel({ docs }: { docs: ReturnType<typeof useDocuments>["docs"] }) {
  // AuthGate guarantees session is non-null, but TS doesn't know that here.
  // We still gate the actual ask call on `session` being present so a future
  // refactor that mounts ChatPanel without AuthGate fails loudly.
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // `useChatMessages()` is a module-level external store with localStorage
  // backing — replacing the old in-context store that wiped on Provider
  // unmount. Module-level state survives navigation between Documents
  // and Chat inside /dashboard; localStorage survives a hard reload.
  const { messages, setMessages } = useChatMessages();

  // First-time seed: when the user opens the chat for the very first
  // time (no persisted history), they should see the greeting. Once
  // they've sent at least one turn, the messages list is already in
  // localStorage and we leave it alone so we don't clobber their work
  // when they flip back from another tab or reload the page.
  useEffect(() => {
    if (messages.length === 0) {
      setMessages(initialMessages);
    }
    // We intentionally only run this on mount, not on every messages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Show the "Jump to latest" pill when the user is scrolled up enough
  // that the auto-scroll-on-new-message behaviour is paused. Show the
  // "Jump to top" pill when they've scrolled *down* past the start of
  // the conversation — i.e. they're reading recent turns and want a
  // fast path back to the earliest greeting.
  const [scrolledUp, setScrolledUp] = useState(false);
  const [scrolledDown, setScrolledDown] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setScrolledUp(distanceFromBottom > 80);
      setScrolledDown(el.scrollTop > 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (scrolledUp) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, scrolledUp]);

  // Voice in chat: STT for the input bar, TTS for read-aloud on answers.
  const { effectivePlan, isOnTrial, plan } = useUsage();
  const voiceAllowed = isOnTrial || canUseVoice(plan, docs.length, effectivePlan);

  // Reply language precedence (mirrors /talk):
  //   1. User-picked language from the dropdown.
  //   2. Document-language detection from the uploaded files.
  //   3. "en-US" (English first).
  const { lang: manualLang } = useVoices();
  const docLang = useMemo(() => detectLangFromDocs(docs), [docs]);
  const replyLang = manualLang === DEFAULT_LANG ? docLang : manualLang;

  const speech = useSpeech({ lang: replyLang, userId });
  const [, setSttLang] = useState<string>(replyLang);
  const [justDictated, setJustDictated] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  const chunks = useMemo(() => allChunks(docs), [docs]);
  const hasDocs = chunks.length > 0;
  const docName = hasDocs && docs.length === 1 ? docs[0].name : undefined;
  const placeholder = hasDocs
    ? docs.length === 1
      ? bilingualPlaceholder(replyLang, docName)
      : `Ask across ${docs.length} documents… or सभी ${docs.length} दस्तावेज़ों में पूछें…`
    : bilingualPlaceholder(replyLang);
  const thinkingCopy = lookupChatCopy(replyLang).thinking;

  const ask = canAsk(effectivePlan);
  const limitReached = !ask.ok;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    if (!hasDocs) {
      setMessages((c) => [
        ...c,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "Add a document on the left first, then ask your question.",
        },
      ]);
      return;
    }
    if (!canAsk(effectivePlan).ok) {
      setMessages((c) => [
        ...c,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "You've hit the Starter monthly question limit. Switch to a paid plan in Billing to keep chatting.",
        },
      ]);
      return;
    }

    await runAskRef.current(trimmed);
    setJustDictated(false);
  }

  // Single source of truth for sending a question. Wrapped in a ref so
  // the Regenerate button (which renders from inside the message map and
  // would otherwise capture a stale closure) sees the freshest list.
  const runAskRef = useRef<(trimmed: string, opts?: { skipUserMsg?: boolean }) => Promise<void>>(
    async () => {},
  );
  runAskRef.current = async function runAsk(trimmed: string, opts?: { skipUserMsg?: boolean }) {
    if (!opts?.skipUserMsg) {
      setMessages((c) => [...c, { id: `u-${Date.now()}`, role: "user", text: trimmed }]);
    }
    setInput("");
    setPending(true);

    const top = scoreChunks(trimmed, chunks, 3).map((c) => c.text);

    if (top.length === 0) {
      setMessages((c) => [
        ...c,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "I couldn't find anything in your document that matches that question. Try rephrasing or upload a different file.",
        },
      ]);
      setPending(false);
      return;
    }

    const liveMessages = messagesRef.current;
    const history = liveMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    try {
      const { answer } = await askChat({
        data: {
          userId: userId ?? "",
          question: trimmed,
          chunks: top,
          history,
          mode: "text",
          forceLang: replyLang,
        },
      });
      setMessages((c) => [...c, { id: `a-${Date.now()}`, role: "assistant", text: answer }]);
      recordQuestion();
    } catch (err) {
      console.error(err);
      const friendly =
        err instanceof ChatRateLimitedError
          ? err.message
          : (() => {
              const raw = err instanceof Error ? err.message : "Unknown error";
              if (
                /GROQ_API_KEY/i.test(raw) ||
                /GROQ request failed/i.test(raw) ||
                /api error/i.test(raw) ||
                /validation/i.test(raw) ||
                /API error/i.test(raw)
              ) {
                return "The chat service is temporarily unavailable. Please try again in a moment.";
              }
              return raw;
            })();
      const prefix =
        err instanceof ChatRateLimitedError ? "" : "Couldn't reach the model right now. ";
      setMessages((c) => [
        ...c,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          text: `${prefix}${friendly}`,
          error: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        toast.success(lookupChatCopy(replyLang).copied);
      } catch (err) {
        console.error("clipboard copy failed", err);
        toast.error("Couldn't copy to clipboard");
      }
    },
    [replyLang],
  );

  const handleFeedback = useCallback((msgId: string, next: "up" | "down") => {
    setMessages((cs) =>
      cs.map((m) => (m.id === msgId ? { ...m, feedback: m.feedback === next ? null : next } : m)),
    );
    console.info("[chat-feedback]", { msgId, value: next });
  }, []);

  const handleRegenerate = useCallback(async (msgId: string) => {
    const list = messagesRef.current;
    const idx = list.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    let prevUserIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        prevUserIdx = i;
        break;
      }
    }
    if (prevUserIdx < 0) return;
    const prompt = list[prevUserIdx].text;
    const before = list.slice(0, idx);
    setMessages(before);
    await runAskRef.current(prompt, { skipUserMsg: true });
  }, []);

  return (
    <section className="flex min-h-[55vh] flex-col gap-3 rounded-2xl border border-border bg-surface-2/30 p-3.5 sm:p-5 lg:min-h-0">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold sm:text-lg">Chat</h2>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <span
              className={
                "size-1.5 rounded-full " +
                (replyLang === DEFAULT_LANG
                  ? "bg-emerald-500"
                  : replyLang.endsWith("-IN")
                    ? "bg-signal"
                    : "bg-amber-500")
              }
              aria-hidden
            />
            <span>
              Replying in{" "}
              <span className="font-medium text-foreground">{nativeForLang(replyLang)}</span>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LanguagePicker />
          {!voiceAllowed ? (
            <Link
              to="/billing"
              className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:text-signal"
            >
              {plan === "starter" ? "Upgrade for unlimited voice" : "Upgrade for voice"}
            </Link>
          ) : null}
        </div>
      </header>

      {limitReached ? (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          You&apos;ve used all your Starter questions this month.{" "}
          <Link to="/billing" className="font-semibold underline">
            Upgrade in Billing
          </Link>{" "}
          to keep going.
        </div>
      ) : null}

      <div
        ref={listRef}
        className="relative max-h-[55vh] flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface-2/30 p-3 sm:p-4 lg:max-h-none"
      >
        <div ref={startRef} aria-hidden />
        {messages.map((m, idx) => {
          const isAssistant = m.role === "assistant" && !m.error;
          const isLastAssistant =
            isAssistant &&
            idx ===
              messages.reduce(
                (last, cur, i) => (cur.role === "assistant" && !cur.error ? i : last),
                -1,
              );
          const cp = lookupChatCopy(replyLang);
          return (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-signal px-3 py-2 text-sm text-signal-foreground"
                  : m.error
                    ? "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              }
            >
              {m.text}
              {isAssistant ? (
                <div className="mt-2 -mb-1 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(m.text)}
                    aria-label="Copy message"
                    title="Copy"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground transition-colors hover:bg-signal/15 hover:text-signal"
                  >
                    <Copy className="size-3" />
                    Copy
                  </button>
                  {isLastAssistant ? (
                    <button
                      type="button"
                      onClick={() => handleRegenerate(m.id)}
                      disabled={pending}
                      aria-label={cp.regenerate}
                      title={cp.regenerate}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground transition-colors hover:bg-signal/15 hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="size-3" />
                      Regenerate
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleFeedback(m.id, "up")}
                    aria-label={cp.goodResponse}
                    aria-pressed={m.feedback === "up"}
                    title={cp.goodResponse}
                    className={
                      "inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-[10px] font-medium transition-colors " +
                      (m.feedback === "up"
                        ? "bg-signal/20 text-signal"
                        : "text-muted-foreground hover:bg-signal/15 hover:text-signal")
                    }
                  >
                    <ThumbsUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFeedback(m.id, "down")}
                    aria-label={cp.badResponse}
                    aria-pressed={m.feedback === "down"}
                    title={cp.badResponse}
                    className={
                      "inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-[10px] font-medium transition-colors " +
                      (m.feedback === "down"
                        ? "bg-red-500/20 text-red-400"
                        : "text-muted-foreground hover:bg-red-500/15 hover:text-red-400")
                    }
                  >
                    <ThumbsDown className="size-3" />
                  </button>
                  {speech.ttsSupported ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (speech.speakingId === m.id) {
                          speech.stopSpeaking();
                        } else {
                          speech.speak(m.id, m.text, replyLang);
                        }
                      }}
                      aria-label={speech.speakingId === m.id ? "Stop reading" : "Read aloud"}
                      title={
                        voiceAllowed
                          ? speech.speakingId === m.id
                            ? "Stop reading"
                            : "Read aloud"
                          : "Read aloud — Personal/Pro only"
                      }
                      disabled={!voiceAllowed}
                      className={
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[10px] font-medium transition-colors " +
                        (speech.speakingId === m.id
                          ? "bg-signal/20 text-signal"
                          : voiceAllowed
                            ? "text-muted-foreground hover:bg-signal/15 hover:text-signal"
                            : "cursor-not-allowed text-muted-foreground/50")
                      }
                    >
                      <Volume2 className="size-3" />
                      {speech.speakingId === m.id ? "Stop" : "Listen"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {pending ? (
          <div className="mr-auto inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1" aria-label={thinkingCopy}>
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:300ms]" />
            </span>
            {thinkingCopy}
          </div>
        ) : null}
        <div ref={endRef} />
        {scrolledUp && messages.length > 3 ? (
          <button
            type="button"
            onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Jump to latest message"
            title="Jump to latest"
            className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-2"
          >
            <ArrowDown className="size-3" />
            Latest
          </button>
        ) : null}
        {scrolledDown && messages.length > 3 ? (
          <button
            type="button"
            onClick={() => startRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Jump to top of conversation"
            title="Jump to top"
            className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-2"
          >
            <ArrowUp className="size-3" />
            Top
          </button>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder={
              speech.sttListening ? `Listening… ${speech.interim || "speak now"}` : placeholder
            }
            className="w-full rounded-xl border border-input bg-surface-2/60 px-3.5 py-2.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
          />
          {voiceAllowed && speech.sttSupported ? (
            <button
              type="button"
              onClick={() => {
                if (speech.sttListening) {
                  speech.stopListening();
                  return;
                }
                speech.startListening((text) => {
                  setSttLang(replyLang);
                  setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
                  setJustDictated(true);
                  window.setTimeout(() => setJustDictated(false), 5000);
                });
              }}
              aria-label={speech.sttListening ? "Stop dictation" : "Dictate"}
              title={
                speech.sttListening
                  ? "Stop dictation"
                  : "Speak to fill the input — press Enter to send"
              }
              className={
                "absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg transition-colors " +
                (speech.sttListening
                  ? "bg-signal/20 text-signal"
                  : "text-muted-foreground hover:bg-signal/15 hover:text-signal")
              }
            >
              <Mic className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          aria-label="Send"
          disabled={!input.trim() || pending || limitReached}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal text-signal-foreground transition-transform hover:scale-[1.03] disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
      {justDictated ? (
        <p aria-live="polite" className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          <Mic className="mr-1 inline-block size-3 -translate-y-px text-signal" />
          Transcript added — review the text above, then press{" "}
          <kbd className="rounded border border-border bg-surface-2 px-1 text-[10px]">Enter</kbd> or
          tap Send.
        </p>
      ) : null}
    </section>
  );
}
