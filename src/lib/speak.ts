// TTS facade — picks the right engine for the current user.
//
// The hook stores the user's choice (browser vs ElevenLabs) in localStorage
// and the server tells us whether ElevenLabs is even configured. We snapshot
// both here so the call site can be a single `speak(...)` regardless of
// where the actual rendering happens.
//
// Why a facade and not inlining the choice in each hook:
//   - `useSpeech` (chat panel read-aloud) and `useMaaraSession` (Talk with
//     Document) both need the same logic. Putting it here means the fallback
//     chain — ElevenLabs → browser SpeechSynthesis → silent — is in one
//     place.
//   - Browser SpeechSynthesis is fired-and-forget; ElevenLabs returns a
//     Promise of audio bytes. We wrap both in a single `Promise<void>` so
//     callers can `await` an answer before moving on (matters in /talk).
//
// Failure modes:
//   - ElevenLabs not configured (or rate-limited / upstream error) → log
//     a one-liner and silently fall back to browser TTS. The user still
//     hears the answer; the only cost is a slightly worse voice.
//   - Both engines unavailable → resolve immediately. The chat panel
//     already disables the speaker button in that case; /talk handles it
//     by moving straight to "idle" without speaking.

import {
  ElevenLabsNotConfiguredError,
  ElevenLabsRateLimitedError,
  ElevenLabsUpstreamError,
  synthesizeSpeech,
} from "@/serverFns/tts";

import { pickVoiceForLang, type TtsProvider, type VoiceGender } from "@/hooks/useVoices";

export type SpeakOptions = {
  // The signed-in user id. Required for ElevenLabs (rate-limited per user);
  // ignored when the active provider is "browser".
  userId: string | null | undefined;
  // The BCP-47 language to use. ElevenLabs picks the appropriate model
  // server-side; SpeechSynthesis picks the matching voice.
  lang: string;
  // Provider preference. The serverFn is only called when this is
  // "elevenlabs" AND the server has confirmed a key.
  provider: TtsProvider;
  // Server-side flag. When false we never even attempt the serverFn.
  elevenlabsAvailable: boolean;
  // Voice gender preference, used to pick the browser SpeechSynthesis voice.
  gender: VoiceGender;
  // Optional override used by the read-aloud button to tag `speakingId`.
  // Pure TTS paths in /talk just leave this undefined.
  id?: string;
  // Called when TTS actually starts (so the UI can flip a "speaking" state).
  onStart?: (id: string) => void;
  // Called when TTS ends or fails (so the UI can clear "speaking" state).
  onEnd?: (id: string) => void;
};

// Resolves with the base64 audio (so callers that want to cache it can do
// so) — but most callers just `await` and discard the bytes.
export type SpeakResult = { audioBase64: string | null };

/**
 * Speak `text` using the configured provider. Returns when audio finishes
 * (or fails). Never throws — TTS is best-effort.
 */
export async function speak(text: string, opts: SpeakOptions): Promise<SpeakResult> {
  const id = opts.id ?? "tts";

  if (opts.provider === "elevenlabs" && opts.elevenlabsAvailable && opts.userId) {
    try {
      const { audioBase64 } = await synthesizeSpeech({
        data: { userId: opts.userId, text, lang: opts.lang },
      });
      await playBase64Audio(audioBase64, { onStart: opts.onStart, onEnd: opts.onEnd, id });
      return { audioBase64 };
    } catch (err) {
      if (
        err instanceof ElevenLabsNotConfiguredError ||
        err instanceof ElevenLabsRateLimitedError ||
        err instanceof ElevenLabsUpstreamError
      ) {
        // Fall through to browser TTS — the user still gets an answer.
        console.warn(
          `[tts] ElevenLabs failed (${err.code}); falling back to browser SpeechSynthesis.`,
        );
      } else {
        console.warn("[tts] ElevenLabs failed with unexpected error:", err);
      }
    }
  }

  await speakBrowser(text, opts.lang, opts.gender, {
    onStart: opts.onStart,
    onEnd: opts.onEnd,
    id,
  });
  return { audioBase64: null };
}

function speakBrowser(
  text: string,
  lang: string,
  gender: VoiceGender,
  cb: { id: string; onStart?: (id: string) => void; onEnd?: (id: string) => void },
): Promise<void> {
  const { id, onStart, onEnd } = cb;
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onEnd?.(id);
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    const voice = pickVoiceForLang(synth.getVoices(), lang, gender);
    if (voice) utter.voice = voice;
    utter.rate = 1.0;
    utter.pitch = 1;
    utter.onstart = () => onStart?.(id);
    utter.onend = () => {
      onEnd?.(id);
      resolve();
    };
    utter.onerror = () => {
      onEnd?.(id);
      resolve();
    };
    synth.speak(utter);
  });
}

/**
 * Play a base64-encoded MP3 via an HTMLAudioElement. Decoded to a data URL
 * once; the browser streams the bytes from there. We resolve on `ended`,
 * reject on `error` so the caller's fallback chain can take over.
 *
 * Why a data URL and not a Blob: the bytes are already in memory (the
 * serverFn returned base64) and a Blob would force an extra decode.
 * Larger payloads would benefit from streaming, but answers are < 5 KB of
 * audio so the data URL is fine.
 */
function playBase64Audio(
  audioBase64: string,
  cb: { id: string; onStart?: (id: string) => void; onEnd?: (id: string) => void },
): Promise<void> {
  const { id, onStart, onEnd } = cb;
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
    let cleanedUp = false;
    const done = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      onEnd?.(id);
      resolve();
    };
    audio.onended = done;
    audio.onerror = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      onEnd?.(id);
      reject(new Error("Audio playback failed."));
    };
    audio.onplay = () => onStart?.(id);
    void audio.play().catch((err: unknown) => {
      if (cleanedUp) return;
      cleanedUp = true;
      onEnd?.(id);
      reject(err);
    });
  });
}
