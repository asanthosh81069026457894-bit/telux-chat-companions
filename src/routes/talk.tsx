// /talk — fullscreen "Talk with Document" voice workspace. Renamed from
// "Talk with Maara" — the persona is gone; the feature keeps its name.
//
// Auth guard: same pattern as BillingPage — bounce to /login if not signed in.
// Plan guard: bounce to a paywall screen if the user is not on a paid plan
// (Talk with Document is included on Personal and Pro).
//
// Empty-state guard: if no documents uploaded, link the user back to /dashboard
// to upload one.
//
// Reuses (do not duplicate):
//   - MaaraOrb.tsx          — animated orb (rings + scan line + equalizer)
//   - useMaaraSession.ts    — STT → askChat (Groq) → TTS state machine
//   - voiceAccess.ts        — voice token (Personal/Pro only)
//   - PLAN_LIMITS           — plan capability table
//
// Language: Talk with Document auto-detects the reply language from the
// document's text via a Unicode-script heuristic in detectLangFromDocs().
// The user can override via the LanguagePicker next to the gender picker
// (manual pick wins, default falls back to document detection). The pick is
// persisted to localStorage so it survives across sessions and across
// routes (chat panel uses the same picker).

import { AuthGate } from "@/components/AuthGate";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  LoaderCircle,
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTalkMessages } from "@/components/dashboard-state";
import { LanguagePicker } from "@/components/LanguagePicker";
import { MaaraOrb } from "@/components/MaaraOrb";
import { VoicePicker } from "@/components/VoicePicker";
import { useAuth } from "@/hooks/useAuth";
import { useDocuments } from "@/hooks/useDocuments";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMaaraSession, type MaaraMessage, type MaaraState } from "@/hooks/useMaaraSession";
import { useUsage } from "@/hooks/useUsage";
import { DEFAULT_LANG, useVoices } from "@/hooks/useVoices";
import { detectLangFromDocs } from "@/lib/detect-lang";
import { canUseVoice, voiceBlockReason } from "@/lib/usage";

const title = "Talk with Document — Telux";
const description =
  "Speak to your documents in any language. Talk with Document reads your files and answers out loud — Hindi, Telugu, Tamil, Bengali, Kannada, Malayalam, Marathi, Gujarati, Punjabi and more.";

export const Route = createFileRoute("/talk")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthGate>
      <TalkPage />
    </AuthGate>
  ),
});

// Number of recent turns kept around so the next answer can use them as
// conversational context. Beyond this we discard to keep the prompt small.
const RECENT_TURNS = 12;

const STATE_HINTS: Record<MaaraState, string> = {
  idle: "Tap the mic and speak — Talk with Document listens, reads your file, and answers.",
  listening: "Listening…",
  thinking: "Reading your document…",
  speaking: "Speaking…",
  error: "Something went wrong. Tap the mic to try again.",
};

function TalkPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { docs } = useDocuments(session?.user?.id);

  // Auth guard — bounce to /login if we know we're not signed in.
  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  // Lock body scroll while the user is in the immersive workspace. Combined
  // with `min-h-[100dvh]` on the shell this gives a true fullscreen feel on
  // iOS Safari where the URL bar and safe areas are accounted for.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  // Plan guard: Talk with Document is included on Personal / Pro / Trial.
  // We pass `effectivePlan` (not the raw DB `plan` column) so trial users —
  // whose DB `plan` is still "free" — are correctly treated as Pro during
  // the 3-day window. `effectivePlan` resolves to "starter" once the trial
  // expires. Done as inline render instead of a redirect so the URL stays
  // at /talk — the user can upgrade and refresh.
  // useUsage() must be called unconditionally (Rules of Hooks), so it sits
  // above the early returns below.
  const { effectivePlan, isOnTrial, plan } = useUsage();
  // docs.length may be 0 while loading — canUseVoice handles 0 correctly
  // (Starter still allowed; PaywallScreen then handles the no-docs empty
  // state further down). `isOnTrial` is an explicit belt-and-braces check:
  // even if the subscription cache is still empty (effectivePlan === "starter")
  // we still allow voice when the trial is active, so a freshly-onboarded user
  // never sees a paywall flash on /talk.
  const voiceAllowed = isOnTrial || canUseVoice("starter", docs.length, effectivePlan);

  if (loading) {
    return <LoadingShell />;
  }
  if (!session) return null;

  // Subscription not yet hydrated — render a thin loading shell instead of the
  // paywall. Without this, a fast user can hit /talk before
  // loadSubscription() resolves and bounce through the wrong screen.
  if (!voiceAllowed) {
    return (
      <PaywallScreen
        onClose={() => void navigate({ to: "/dashboard" })}
        reason={voiceBlockReason(effectivePlan, docs.length, effectivePlan) ?? undefined}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Talk with Document"
      className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-background"
      style={{ height: "100dvh" }}
    >
      <AmbientField />

      {/* Top bar: back to dashboard + title + voice picker + close */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-8 sm:pt-[max(1rem,env(safe-area-inset-top))]">
        <Link
          to="/dashboard"
          aria-label="Back to dashboard"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-signal">
            <Sparkles className="size-3.5 text-signal-foreground" />
          </span>
          <h1 className="truncate font-display text-base font-bold sm:text-lg">
            Talk with Document
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LanguagePicker />
          <VoicePicker />
          <button
            type="button"
            onClick={() => void navigate({ to: "/dashboard" })}
            aria-label="Close"
            className="grid size-10 place-items-center rounded-full border border-border bg-surface/70 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {docs.length === 0 ? (
        <NoDocsScreen onClose={() => void navigate({ to: "/dashboard" })} />
      ) : (
        <Workspace docs={docs} isMobile={isMobile} userId={session.user.id} />
      )}
    </div>
  );
}

/* ---------- workspace (orb + mic + transcript) ---------- */

function Workspace({
  docs,
  isMobile,
  userId,
}: {
  docs: ReturnType<typeof useDocuments>["docs"];
  isMobile: boolean;
  userId: string;
}) {
  // Reply language: prefer the user's manual pick from the LanguagePicker
  // (persisted to localStorage). Only fall back to the document-detection
  // heuristic when the user hasn't picked anything yet — that way, "English
  // default" yields auto-detection as before, but as soon as the user
  // taps Hindi in the picker it sticks for the rest of the session.
  const { lang: manualLang } = useVoices();
  const detectedLang = useMemo(() => detectLangFromDocs(docs), [docs]);
  const pickedLang = manualLang === DEFAULT_LANG ? detectedLang : manualLang;

  // Rolling transcript. Lives in the shared module-level store
  // (`useTalkMessages`) so navigating away to /dashboard and back doesn't
  // wipe the conversation — that's the whole point of the recent
  // "don't lose my chat history" complaint. The session hook only emits
  // single-turn deltas, so this Workspace is responsible for appending them.
  const { messages, setMessages } = useTalkMessages();

  const onAnswer = useCallback(
    (q: string, a: string) => {
      setMessages((m) => {
        const next = [
          ...m,
          { id: `u-${Date.now()}`, role: "user" as const, text: q },
          { id: `a-${Date.now()}`, role: "assistant" as const, text: a },
        ];
        return next.slice(-(RECENT_TURNS * 2));
      });
    },
    [setMessages],
  );

  const onError = useCallback(
    (msg: string) => {
      setMessages((m) =>
        [
          ...m,
          {
            id: `e-${Date.now()}`,
            role: "assistant" as const,
            text: msg,
            error: true,
          },
        ].slice(-(RECENT_TURNS * 2)),
      );
    },
    [setMessages],
  );

  const history = useMemo<MaaraMessage[]>(() => messages.slice(-RECENT_TURNS), [messages]);

  // Voice session. mode: "voice" forces the serverFn to verify the user's
  // effective plan against `public.subscriptions` (Starter rejected).
  const session = useMaaraSession({
    docs,
    history,
    onAnswer,
    onError,
    forceLang: pickedLang,
    mode: "voice",
    userId,
  });

  const endRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Show the "Latest" pill when the user has scrolled up away from the
  // newest turn (the rolling transcript is small but a long session can
  // still overflow it). Show the "Top" pill when they've scrolled
  // down past the start so the earliest greeting stays one tap away.
  const [scrolledUp, setScrolledUp] = useState(false);
  const [scrolledDown, setScrolledDown] = useState(false);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setScrolledUp(distanceFromBottom > 40);
      setScrolledDown(el.scrollTop > 40);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, session.state, session.interim]);

  return (
    <div className="relative z-10 flex flex-1 flex-col px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-4">
      {/* Center stage: orb + hint + mic */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="relative">
          <ParticleField state={session.state} />
          <MaaraOrb
            state={session.state}
            size={isMobile ? 240 : 360}
            className="relative z-10 motion-reduce:scale-90"
          />
        </div>

        <p aria-live="polite" className="max-w-md text-center text-sm text-muted-foreground">
          {session.state === "listening" && session.interim
            ? `“${session.interim.trim()}”`
            : STATE_HINTS[session.state]}
        </p>

        <DetectedLangBadge lang={pickedLang} />

        <button
          type="button"
          onClick={() => session.start()}
          disabled={session.state === "thinking" || session.state === "listening"}
          aria-label={micLabel(session.state)}
          className={
            "group relative grid place-items-center rounded-full transition-transform motion-reduce:transition-none " +
            (isMobile ? "size-16" : "size-20") +
            " " +
            (session.state === "listening"
              ? "bg-signal text-signal-foreground pulse-ring shadow-[var(--shadow-signal)]"
              : session.state === "speaking"
                ? "border-2 border-signal bg-signal/15 text-signal hover:bg-signal/25"
                : session.state === "thinking"
                  ? "bg-signal text-signal-foreground shadow-[var(--shadow-signal)]"
                  : session.state === "error"
                    ? "border-2 border-red-400/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    : "border-2 border-signal/40 bg-signal/10 text-signal hover:scale-105 hover:bg-signal/20")
          }
        >
          {session.state === "listening" ? (
            <Mic className={isMobile ? "size-7" : "size-8"} />
          ) : session.state === "speaking" ? (
            <Volume2 className={isMobile ? "size-7" : "size-8"} />
          ) : session.state === "thinking" ? (
            <LoaderCircle className={isMobile ? "size-7" : "size-8 animate-spin"} />
          ) : session.state === "error" ? (
            <MicOff className={isMobile ? "size-7" : "size-8"} />
          ) : (
            <Mic className={isMobile ? "size-7" : "size-8"} />
          )}
        </button>
      </div>

      {/* Error banner */}
      {session.error && session.state === "error" ? (
        <div
          role="alert"
          className="mx-auto mt-2 flex max-w-xl items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">{session.error}</span>
          <button
            type="button"
            onClick={() => session.start()}
            className="rounded-md border border-red-400/30 px-2 py-0.5 text-[11px] font-medium hover:bg-red-500/15"
          >
            Try again
          </button>
        </div>
      ) : null}

      {/* Transcript — bottom strip */}
      <div
        ref={transcriptRef}
        className="relative mx-auto mt-3 w-full max-w-3xl flex-1 space-y-2 overflow-y-auto rounded-2xl border border-border bg-surface-2/40 p-3"
        style={{ minHeight: 110, maxHeight: isMobile ? 160 : 220 }}
      >
        <div ref={startRef} aria-hidden />
        {messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            Your conversation will appear here. Speak in any language and Talk with Document answers
            in yours.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={m.id ?? i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-signal px-3 py-1.5 text-sm text-signal-foreground"
                  : m.error
                    ? "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-400"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              }
            >
              {m.text}
            </div>
          ))
        )}
        <div ref={endRef} />
        {scrolledUp && messages.length > 2 ? (
          <button
            type="button"
            onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Jump to latest"
            title="Jump to latest"
            className="absolute right-2 bottom-2 z-10 inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface/95 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-surface-2"
          >
            <ArrowDown className="size-3" />
          </button>
        ) : null}
        {scrolledDown && messages.length > 2 ? (
          <button
            type="button"
            onClick={() => startRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Jump to top of conversation"
            title="Jump to top"
            className="absolute left-2 bottom-2 z-10 inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface/95 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-surface-2"
          >
            <ArrowUp className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- voice picker + detected-language badge ---------- */

// `VoicePicker` is now imported from `@/components/VoicePicker` so the same
// dropdown can mount in /talk, the dashboard header, and anywhere else the
// user might want to flip Auto/Female/Male. Pick persists to localStorage
// and is read by `useSpeech` (chat read-aloud) and `useMaaraSession`
// (Talk with Document) simultaneously.

// Tiny pill that shows the language Talk with Document picked from the doc.
// Helps the user understand why the answer is in, e.g., Hindi. Falls back to
// the user's spoken language once a final transcript lands (handled in the
// workspace).
function DetectedLangBadge({ lang }: { lang: string }) {
  const label = LANG_DISPLAY[lang] ?? lang;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-2.5 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
      <span className="size-1.5 rounded-full bg-signal" aria-hidden />
      Detected · {label}
    </span>
  );
}

const LANG_DISPLAY: Record<string, string> = {
  "en-US": "English",
  "en-GB": "English (UK)",
  "en-IN": "English (IN)",
  "hi-IN": "हिन्दी",
  "bn-IN": "বাংলা",
  "te-IN": "తెలుగు",
  "ta-IN": "தமிழ்",
  "kn-IN": "ಕನ್ನಡ",
  "ml-IN": "മലയാളം",
  "gu-IN": "ગુજરાતી",
  "pa-IN": "ਪੰਜਾਬੀ",
  "mr-IN": "मराठी",
  "or-IN": "ଓଡ଼ିଆ",
  "ar-SA": "العربية",
  "ru-RU": "Русский",
  "zh-CN": "中文",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
};

/* ---------- particle field + ambient backdrop ---------- */

function ParticleField({ state }: { state: MaaraState }) {
  const count = state === "idle" ? 14 : 24;
  const speed = state === "idle" ? 18 : state === "error" ? 10 : 8;
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        i,
        angle: (i / count) * Math.PI * 2,
        radius: 150 + ((i * 37) % 60),
        size: 2 + (i % 3),
        delay: (i * 0.4) % speed,
        drift: 6 + (i % 5) * 2,
      })),
    [count, speed],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="relative" style={{ width: 0, height: 0 }}>
        {particles.map((p) => (
          <span
            key={p.i}
            className="maara-particle absolute rounded-full"
            style={
              {
                width: p.size,
                height: p.size,
                background: "color-mix(in oklab, var(--signal) 80%, transparent)",
                boxShadow: "0 0 8px color-mix(in oklab, var(--signal) 60%, transparent)",
                left: Math.cos(p.angle) * p.radius,
                top: Math.sin(p.angle) * p.radius,
                animationDuration: `${speed}s`,
                animationDelay: `${-p.delay}s`,
                "--drift": `${p.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

function AmbientField() {
  // Soft radial glow behind the orb so the dark background doesn't feel flat.
  // No JS, no animation — pure CSS.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-80"
      style={{
        background:
          "radial-gradient(circle at 50% 38%, color-mix(in oklab, var(--signal) 18%, transparent) 0%, transparent 55%), radial-gradient(circle at 80% 80%, color-mix(in oklab, var(--chart-3) 12%, transparent) 0%, transparent 50%)",
      }}
    />
  );
}

/* ---------- empty / paywall / loading screens ---------- */

function LoadingShell() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-signal">
          <span className="size-3 rounded-[3px] bg-signal-foreground" />
        </span>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">Loading…</p>
      </div>
    </div>
  );
}

function NoDocsScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <div className="grid size-14 place-items-center rounded-full border border-signal/40 bg-signal/10 text-signal">
        <Mic className="size-6" />
      </div>
      <h2 className="text-2xl font-semibold">Upload a document first</h2>
      <p className="text-sm text-muted-foreground">
        Talk with Document reads from your own files. Add at least one document and it will start
        talking to you — in the language it detects in your file, in any language your browser
        supports.
      </p>
      <Link
        to="/dashboard"
        search={{ view: "documents" }}
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-full bg-signal px-5 py-2.5 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.02]"
      >
        Go to Documents <ArrowLeft className="size-4 rotate-180" />
      </Link>
    </div>
  );
}

function PaywallScreen({ onClose, reason }: { onClose: () => void; reason?: string }) {
  return (
    <>
      <AmbientField />
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-10 place-items-center rounded-full border border-border bg-surface/70 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="relative z-10 m-auto flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <div className="grid size-14 place-items-center rounded-full border border-signal/40 bg-signal/10 text-signal">
          <Sparkles className="size-6" />
        </div>
        <h2 className="text-2xl font-semibold">Talk with Document needs a paid plan</h2>
        <p className="text-sm text-muted-foreground">
          {reason ??
            "Talk with Document is included on Personal and Pro plans. Upgrade to keep talking to your documents in any language."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/billing"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full bg-signal px-5 py-2.5 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.02]"
          >
            View plans
          </Link>
          <Link
            to="/dashboard"
            onClick={onClose}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Maybe later
          </Link>
        </div>
      </div>
    </>
  );
}

/* ---------- helpers ---------- */

// `detectLangFromDocs` lives in `@/lib/detect-lang` so the chat panel and
// /talk can share the same heuristic.

function micLabel(state: MaaraState): string {
  switch (state) {
    case "listening":
      return "Listening — tap to stop";
    case "speaking":
      return "Tap to interrupt";
    case "thinking":
      return "Thinking…";
    case "error":
      return "Try again";
    case "idle":
    default:
      return "Tap to speak";
  }
}
