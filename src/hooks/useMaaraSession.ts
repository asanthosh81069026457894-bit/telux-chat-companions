// Talk-with-Document voice session hook.
//
// The persona "Maara" was retired in favour of the feature name "Talk with
// Document". File name and exported type names (`MaaraState`, `MaaraMessage`)
// are intentionally kept for code-split cache stability — they are internal
// identifiers, not user-facing. All user-facing copy in this file (error
// messages, the askChat mode label) was updated.
//
// State machine: idle → listening → thinking → speaking → idle.
//   - STT: browser-native `SpeechRecognition` (with `webkitSpeechRecognition` fallback).
//   - LLM: the same `askChat` serverFn the chat panel uses, with the voice
//     system prompt.
//   - TTS: browser-native `SpeechSynthesis`, voice picked by BCP-47 lang prefix.
//   - Barge-in: tapping the mic while `speaking` cancels TTS and restarts listening.
//
// We do not stream TTS — browsers don't expose a streaming API for it. The
// whole answer is spoken in one utterance. We do not record or persist audio:
// `SpeechRecognition` consumes it inside the browser and never reaches our
// server. Only the transcribed text + the same pre-scored chunks as chat
// leave the device, via the existing `askChat` serverFn.
//
// Reuses (intentionally, not duplicated):
//   - allChunks()        — src/lib/documents.ts
//   - scoreChunks()      — src/lib/scoring.ts
//   - askChat()          — src/lib/chat.ts
//   - canAsk()/recordQuestion() — src/lib/usage.ts (Starter quota guard)
//
// Optional future upgrade path: drop in ElevenLabs TTS or Google Cloud
// Speech-to-Text here without touching Talk-with-Document consumers.

import { useCallback, useEffect, useRef, useState } from "react";

import { askChat } from "@/lib/chat";
import { allChunks, type StoredDocument } from "@/lib/documents";
import { scoreChunks } from "@/lib/scoring";
import { speak as speakViaFacade } from "@/lib/speak";
import { getSubscriptionSnapshot } from "@/lib/subscription";
import { canAsk, recordQuestion, type Plan } from "@/lib/usage";

import { useVoices } from "./useVoices";

// Read the latest subscription snapshot synchronously. Used to pass
// `effectivePlan` to the local `canAsk` quota guard so trial / paid users
// aren't accidentally locked out by the Starter monthly cap.
function getCurrentEffectivePlan(): Plan {
  return getSubscriptionSnapshot().effectivePlan;
}

export type MaaraState = "idle" | "listening" | "thinking" | "speaking" | "error";

export type MaaraMessage = { role: "user" | "assistant"; text: string; error?: boolean };

export type UseMaaraSessionOpts = {
  docs: StoredDocument[];
  // Last few turns so Maara can hold a short conversational context.
  history: MaaraMessage[];
  // Called when Maara finishes answering (state transitions out of `speaking`).
  // The panel uses this to append to its transcript.
  onAnswer: (q: string, a: string) => void;
  // Called for user-facing errors (mic blocked, model unreachable, etc.).
  onError: (msg: string) => void;
  // User-picked language from the dropdown. Acts as a hint to STT and a
  // filter for TTS voice selection. Auto-detected lang overrides this once
  // the first final transcript lands.
  forceLang?: string;
  // "voice" = Talk-with-Document / read-aloud; server enforces the paywall
  // by reading the user's `subscriptions` row in Supabase.
  // Omit for the in-page text MaaraPanel which uses the default text mode.
  mode?: "text" | "voice";
  // Signed-in user id. Required so the server can resolve the user's plan.
  userId?: string | null;
};

export type UseMaaraSessionResult = {
  state: MaaraState;
  interim: string;
  finalText: string;
  lang: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  supported: boolean;
  ttsSupported: boolean;
  ttsVoices: ReturnType<typeof useVoices>["voices"];
};

// --- Browser types we touch -----------------------------------------------------

// The TypeScript DOM lib doesn't always include `SpeechRecognition` (Chrome
// prefixes it as `webkitSpeechRecognition`). Pick whichever exists.
type SR = typeof window extends { SpeechRecognition: infer T } ? T : never;
type RecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    // Indexed by alternative index — maxAlternatives may be up to 3, so we
    // treat the shape as a numeric-indexed array rather than a tuple.
    [index: number]: { transcript: string; confidence: number; lang?: string };
  }>;
}

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// --------------------------------------------------------------------------------

export function useMaaraSession(opts: UseMaaraSessionOpts): UseMaaraSessionResult {
  const { docs, history, onAnswer, onError, forceLang, mode, userId } = opts;

  const [state, setState] = useState<MaaraState>("idle");
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [lang, setLang] = useState<string>(forceLang ?? "en-US");
  const [error, setError] = useState<string | null>(null);

  // Refs we need to read from inside async callbacks without re-binding.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false); // re-entrancy guard for rapid taps
  const historyRef = useRef<MaaraMessage[]>(history);
  const docsRef = useRef<StoredDocument[]>(docs);
  const langRef = useRef<string>(forceLang ?? "en-US");
  const onAnswerRef = useRef(onAnswer);
  const onErrorRef = useRef(onError);
  const modeRef = useRef<"text" | "voice">(mode ?? "text");
  const userIdRef = useRef<string | null | undefined>(userId);
  // Mirror of the current state — read by async callbacks (e.g. recognition
  // onend) that would otherwise capture a stale value via JS closure.
  const stateRef = useRef<MaaraState>("idle");
  // Silence watchdog: cleared on every interim result, fires after the silence
  // window of no new speech (1.4 s — long enough to allow a mid-thought
  // pause but short enough that the user feels responded-to). When it fires
  // we stop recognition, which lets onresult's "isFinal" commit land in
  // onend. This lets users pause mid-thought (e.g. "what does the document
  // say about… [pause] …refunds") without being cut off at the first silence.
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held aside while we wait for more speech; becomes the basis for the
  // commit once the silence window elapses.
  const pendingTextRef = useRef<string>("");
  // Abort the in-flight askChat() request on unmount or cancel so the UI
  // never tries to speak a stale answer after navigation.
  const abortRef = useRef<AbortController | null>(null);

  // Keep refs in sync with the latest props/options.
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);
  useEffect(() => {
    if (forceLang) {
      langRef.current = forceLang;
      setLang(forceLang);
    }
  }, [forceLang]);
  useEffect(() => {
    onAnswerRef.current = onAnswer;
  }, [onAnswer]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    modeRef.current = mode ?? "text";
  }, [mode]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const {
    supported: ttsSupported,
    voices: ttsVoices,
    gender: ttsGender,
    ttsProvider,
    elevenlabsAvailable,
  } = useVoices();

  const supported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  // ------------------------------------------------------------------
  // TTS: speak `text` in `lang`, resolve when finished.
  // ------------------------------------------------------------------
  const speak = useCallback(
    async (text: string, langForSpeech: string): Promise<void> => {
      // Cancel any browser-SpeechSynthesis utterance already in flight. The
      // facade handles the actual playback; we just need to make sure a
      // quick follow-up question doesn't queue behind a long answer.
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
      await speakViaFacade(text, {
        userId: userIdRef.current,
        lang: langForSpeech,
        provider: ttsProvider,
        elevenlabsAvailable,
        gender: ttsGender,
      });
    },
    [ttsProvider, elevenlabsAvailable, ttsGender],
  );

  // ------------------------------------------------------------------
  // Build the chat request: same pipeline as the chat panel.
  // ------------------------------------------------------------------
  const askModel = useCallback(async (question: string, langForSpeech: string) => {
    const all = allChunks(docsRef.current);
    if (all.length === 0) {
      throw new Error("No documents uploaded yet.");
    }
    const top = scoreChunks(question, all, 3).map((c) => c.text);
    const hist = historyRef.current
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));
    const { answer } = await askChat({
      data: {
        userId: userIdRef.current ?? "",
        question,
        chunks: top,
        history: hist,
        mode: modeRef.current,
      },
    });
    return { answer, langForSpeech };
  }, []);

  // ------------------------------------------------------------------
  // Core listen-then-think-then-speak cycle.
  // ------------------------------------------------------------------
  const runCycle = useCallback(
    async (text: string, detectedLang: string) => {
      // Quota guard — same Starter plan rule as the chat panel. We don't
      // know the user's effective plan here without a hook call, so we read
      // the current subscription snapshot directly. talk-with-Document is a
      // paid feature, so on a real device this path is reached only on
      // Personal / Pro / trial — all of which are unlimited.
      //
      // Edge case: if loadSubscription() hasn't completed yet (first paint
      // after sign-in), the snapshot returns the default "starter" plan and
      // we'd wrongly block a trial user. We let it through in that window —
      // the serverFn still re-checks via the chat proxy, so a true Starter
      // user gets blocked at the server, not here.
      const effectivePlan = getCurrentEffectivePlan();
      if (effectivePlan !== "starter" && !canAsk(effectivePlan).ok) {
        const msg =
          "You've used all your Starter questions this month. Upgrade in Billing to keep talking.";
        setError(msg);
        onErrorRef.current(msg);
        setState("error");
        return;
      }

      setState("thinking");
      // Abort previous in-flight request if any (barge-in or unmount).
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { answer } = await askModel(text, detectedLang);
        // Guard against navigation mid-flight — the component may already be
        // unmounted by the time askChat resolves. Don't try to speak or set
        // state on a dead instance.
        if (!mountedRef.current || controller.signal.aborted) return;
        // TTS in the detected/forced language; fall back to the answer's
        // natural language if TTS is unavailable.
        if (ttsSupported) {
          setState("speaking");
          await speak(answer, detectedLang);
        }
        if (!mountedRef.current || controller.signal.aborted) return;
        recordQuestion();
        onAnswerRef.current(text, answer);
      } catch (err) {
        // Aborted by cancel/unmount — silent return, no error toast.
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        console.error("Talk-with-Document ask failed", err);
        const raw = err instanceof Error ? err.message : "Unknown error";
        // Map backend-language errors to a clear, single-line message. The
        // raw detail stays in the developer console for diagnosis.
        const isBackend =
          /GROQ_API_KEY/i.test(raw) ||
          /GROQ request failed/i.test(raw) ||
          /api error/i.test(raw) ||
          /API error/i.test(raw);
        const msg = isBackend
          ? "The voice service is temporarily unavailable. Please try again in a moment."
          : `I couldn't reach the model right now. ${raw}`;
        setError(msg);
        onErrorRef.current(msg);
        setState("error");
        return;
      }
      setInterim("");
      setFinalText("");
      setState("idle");
    },
    [askModel, speak, ttsSupported],
  );

  // ------------------------------------------------------------------
  // Public controls.
  // ------------------------------------------------------------------
  const cancel = useCallback(() => {
    busyRef.current = false;
    // Abort any in-flight askChat so a stale answer never lands.
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
      abortRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    pendingTextRef.current = "";
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    setInterim("");
    setState("idle");
  }, []);

  const stop = useCallback(() => {
    // Like cancel, but for the case where the user wants to commit what was
    // said (interim becomes final).
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    if (busyRef.current) {
      // Barge-in: interrupt whatever's happening and start fresh.
      cancel();
      // Restart on the next tick so cancel's setState("idle") lands first.
      setTimeout(() => start(), 30);
      return;
    }
    busyRef.current = true;

    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = langRef.current;
    // Continuous so a paused sentence isn't lost mid-thought, plus a
    // silence-watchdog below that commits once the user has been quiet for
    // ~1.2 s.
    rec.continuous = true;
    rec.interimResults = true;
    // Ask the recognizer for up to 3 candidates so we can pick the most
    // confident one on a final — the first alternative is often wrong when
    // accent / mic quality are slightly off.
    rec.maxAlternatives = 3;

    const SILENCE_MS = 1400;
    const armSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        // Stop the recognizer. The browser fires onresult with isFinal=true
        // for any pending transcript, then onend. We commit in onresult, so
        // the onend path just clears busy state without clobbering it.
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }, SILENCE_MS);
    };

    rec.onresult = (event) => {
      let interimText = "";
      let finalTextLocal = "";
      let finalLang: string | undefined;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        // Pick the highest-confidence alternative if multiple were returned.
        let best: { transcript: string; confidence: number; lang?: string } | null = null;
        for (let j = 0; j < result.length; j++) {
          const alt = result[j];
          if (!alt) continue;
          if (!best || alt.confidence > best.confidence) best = alt;
        }
        if (!best) continue;
        if (result.isFinal) {
          finalTextLocal += best.transcript;
          finalLang = finalLang ?? best.lang;
        } else {
          interimText += best.transcript;
        }
      }
      if (interimText) {
        setInterim(interimText);
        // Hold the latest interim in case the silence timer fires before a
        // "isFinal" lands. We commit whatever's most recent.
        pendingTextRef.current = interimText;
        armSilenceTimer();
      }
      if (finalTextLocal) {
        const trimmed = finalTextLocal.trim();
        if (trimmed) {
          setFinalText(trimmed);
          setInterim("");
          pendingTextRef.current = "";
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          if (finalLang) {
            langRef.current = finalLang;
            setLang(finalLang);
          }
          // Commit immediately; stop recognition so the user can hear
          // themselves think.
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
          void runCycle(trimmed, finalLang ?? langRef.current);
        }
      }
    };

    rec.onerror = (e) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      const code = e.error ?? "";
      // no-speech and aborted are user-cancelled, not real errors.
      if (code === "no-speech" || code === "aborted") {
        setInterim("");
        busyRef.current = false;
        setState("idle");
        return;
      }
      const friendly =
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access was blocked. Click the lock icon in the address bar to allow it, then try again."
          : code === "audio-capture"
            ? "I can't find a microphone on this device."
            : code === "network"
              ? "Voice service is unreachable. Check your connection and try again."
              : "Voice input failed. Try again or type your question instead.";
      setError(friendly);
      onErrorRef.current(friendly);
      busyRef.current = false;
      setState("error");
    };

    rec.onend = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      // Don't clobber the "thinking" / "speaking" state if recognition ends
      // naturally after we already committed a final transcript.
      if (!mountedRef.current) return;
      // Race fix: only flip busyRef back to false while we are still in the
      // "listening" phase. If runCycle() already advanced us into
      // "thinking" / "speaking" / "error", leave busyRef alone so the next
      // tap from the user cancels correctly via the barge-in path.
      if (stateRef.current === "listening") {
        busyRef.current = false;
        // If we got a `no-speech` and the user said nothing, fall through.
        // But if the silence timer fired and there's pending interim text,
        // commit it now so a mid-thought pause isn't lost.
        const pending = pendingTextRef.current.trim();
        if (pending) {
          pendingTextRef.current = "";
          setInterim("");
          setFinalText(pending);
          void runCycle(pending, langRef.current);
          return;
        }
        setState("idle");
        setInterim("");
      }
    };

    recognitionRef.current = rec;
    setError(null);
    setInterim("");
    setFinalText("");
    pendingTextRef.current = "";
    setState("listening");
    try {
      rec.start();
    } catch (err) {
      console.error("recognition.start() threw", err);
      busyRef.current = false;
      setState("idle");
    }
    // We intentionally don't depend on `state` here — that would cause
    // a re-bind mid-session. Eslint disable is appropriate.
  }, [supported, cancel, runCycle]);

  // ------------------------------------------------------------------
  // Teardown on unmount.
  // ------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      // Abort any in-flight chat request so a late answer never lands here.
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          /* ignore */
        }
        abortRef.current = null;
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return {
    state,
    interim,
    finalText,
    lang,
    error,
    start,
    stop,
    cancel,
    supported,
    ttsSupported,
    ttsVoices,
  };
}
