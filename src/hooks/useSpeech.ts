// useSpeech — small wrapper around the Web Speech API that powers:
//   - STT (SpeechRecognition) for the chat mic
//   - TTS (SpeechSynthesis) for "read aloud" on chat answers
//
// Both halves are progressive: if the browser doesn't expose them, the hook
// returns `supported: false` and the UI quietly hides the buttons. No
// errors are thrown. Language defaults to "en-US" but auto-detects the active
// voice from useVoices() so Hindi/Telugu/etc. TTS picks the right voice when
// installed on the OS.

import { useCallback, useEffect, useRef, useState } from "react";

import { speak as speakViaFacade } from "@/lib/speak";

import { useVoices } from "./useVoices";

export type UseSpeechOptions = {
  // BCP-47 lang hint used to seed STT and TTS. Auto-adjusts on first transcript.
  lang?: string;
  // Signed-in user id, required so the ElevenLabs TTS serverFn can rate-limit
  // per user. Pass `null` for anonymous use (read-aloud will silently fall
  // back to browser SpeechSynthesis).
  userId?: string | null;
};

export type UseSpeechResult = {
  // STT
  sttSupported: boolean;
  sttListening: boolean;
  interim: string;
  startListening: (onResult: (text: string, lang: string) => void) => void;
  stopListening: () => void;
  // TTS
  ttsSupported: boolean;
  speakingId: string | null;
  speak: (id: string, text: string, lang?: string) => void;
  stopSpeaking: () => void;
  voices: ReturnType<typeof useVoices>["voices"];
};

// --- types we touch -----------------------------------------------------------

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    0: { transcript: string; confidence: number; lang?: string };
  }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------

export function useSpeech(opts: UseSpeechOptions = {}): UseSpeechResult {
  const { lang = "en-US", userId = null } = opts;
  // We pull the voices, gender, provider and availability flag from
  // useVoices so the chat panel's read-aloud button honours the same pickers
  // as Talk with Document. The store keeps localStorage["telux:voice-*"].
  const { supported: ttsSupported, voices, gender, ttsProvider, elevenlabsAvailable } = useVoices();
  const sttSupported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  const [sttListening, setSttListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const langRef = useRef<string>(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setSttListening(false);
    setInterim("");
  }, []);

  const startListening = useCallback(
    (onResult: (text: string, lang: string) => void) => {
      if (!sttSupported) return;
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      const rec = new Ctor();
      rec.lang = langRef.current;
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        let interimText = "";
        let finalText = "";
        let detectedLang: string | undefined;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alt = result[0];
          if (!alt) continue;
          if (result.isFinal) {
            finalText += alt.transcript;
            detectedLang = detectedLang ?? alt.lang;
          } else {
            interimText += alt.transcript;
          }
        }
        if (interimText) setInterim(interimText);
        if (finalText.trim()) {
          setInterim("");
          onResult(finalText.trim(), detectedLang ?? langRef.current);
        }
      };
      rec.onerror = () => {
        setSttListening(false);
        setInterim("");
      };
      rec.onend = () => {
        setSttListening(false);
        setInterim("");
      };
      recRef.current = rec;
      setInterim("");
      try {
        rec.start();
        setSttListening(true);
      } catch {
        setSttListening(false);
      }
    },
    [sttSupported],
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (id: string, text: string, speakLang?: string) => {
      if (!ttsSupported) return;
      // Cancel any in-flight utterance immediately so the user perceives a
      // quick response when they hit the read-aloud button repeatedly.
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
      setSpeakingId(id);
      const target = speakLang ?? langRef.current;
      void speakViaFacade(text, {
        userId,
        lang: target,
        provider: ttsProvider,
        elevenlabsAvailable,
        gender,
        id,
        onStart: (startedId) => setSpeakingId(startedId),
        onEnd: (endedId) => setSpeakingId((cur) => (cur === endedId ? null : cur)),
      }).catch((err: unknown) => {
        // The facade already swallows expected errors (no key / rate-limited /
        // upstream). Anything that lands here is unexpected — log and clear
        // the speaking state so the UI doesn't get stuck.
        console.warn("[useSpeech] speak() failed:", err);
        setSpeakingId(null);
      });
    },
    [ttsSupported, gender, ttsProvider, elevenlabsAvailable, userId],
  );

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
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
    sttSupported,
    sttListening,
    interim,
    startListening,
    stopListening,
    ttsSupported,
    speakingId,
    speak,
    stopSpeaking,
    voices,
  };
}
