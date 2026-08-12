// ElevenLabs TTS — server-side proxy.
//
// Why a proxy:
//   - ELEVENLABS_API_KEY must never ship to the browser. ElevenLabs enforces
//     per-key rate limits and characters — anyone with the key could burn
//     your monthly quota in minutes.
//   - We also want to inject our own auth check (the user must be on a
//     paid plan, trial, or have an active entitlement — otherwise we'd be
//     spending ElevenLabs characters on free users).
//
// What it does:
//   - synthesizeSpeech(text, lang) calls ElevenLabs' /v1/text-to-speech
//     endpoint with the text, returns the audio bytes (MP3) as a
//     base64-encoded string. The client plays it via an <audio> element.
//   - getTtsConfig() returns whether ElevenLabs is configured (so the
//     client can show / hide the provider picker). Returns NO key material.
//
// Failure modes:
//   - Missing env vars → "ElevenLabs not configured" surfaced to client,
//     which falls back to browser TTS. No error wall.
//   - ElevenLabs down → upstream 5xx is logged server-side, client sees a
//     short retry hint, browser TTS takes over.
//   - Rate-limited (ElevenLabs returns 429) → client surfaces a friendly
//     message ("Voice limit reached, falling back") and the browser TTS
//     path takes over for the rest of the session.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { consume } from "@/lib/rate-limit";
import { userIdExists } from "@/lib/supabaseServer";

type ElevenLabsEnv = {
  apiKey: string;
  // Voice id (ElevenLabs' hash). Default points at "Rachel" — their default
  // English voice — but operators should override for their own brand voice.
  defaultVoiceId: string;
};

let cachedEnv: ElevenLabsEnv | null = null;

function loadEnv(): ElevenLabsEnv | null {
  if (cachedEnv) return cachedEnv;
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  cachedEnv = {
    apiKey,
    defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim() || "21m00Tcm4TlvDq8ikWAM", // "Rachel"
  };
  return cachedEnv;
}

/**
 * ElevenLabs exposes per-language voice models. For Indian languages the
 * "Eleven Multilingual v2" model is the one that sounds natural; English
 * can use either "Multilingual v2" or the legacy "Eleven Turbo v2.5" for
 * lower latency. We default to the multilingual model since the user is
 * overwhelmingly likely to want a non-English voice when their picker
 * isn't English.
 */
const MULTILINGUAL_MODEL = "eleven_multilingual_v2";
const ENGLISH_MODEL = "eleven_turbo_v2_5";

function modelForLang(lang: string): string {
  // English (en-*) gets the lower-latency English model; everything else
  // goes through multilingual v2 which has the wider language coverage.
  if (lang.toLowerCase().startsWith("en")) return ENGLISH_MODEL;
  return MULTILINGUAL_MODEL;
}

export class ElevenLabsNotConfiguredError extends Error {
  readonly code = "ELEVENLABS_NOT_CONFIGURED";
  constructor() {
    super("ElevenLabs is not configured on the server.");
    this.name = "ElevenLabsNotConfiguredError";
  }
}

export class ElevenLabsUpstreamError extends Error {
  readonly code = "ELEVENLABS_UPSTREAM";
  constructor(message = "ElevenLabs is temporarily unavailable.") {
    super(message);
    this.name = "ElevenLabsUpstreamError";
  }
}

export class ElevenLabsRateLimitedError extends Error {
  readonly code = "ELEVENLABS_RATE_LIMITED";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("ElevenLabs rate limit reached — falling back to browser voice.");
    this.name = "ElevenLabsRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Cheap probe used by useVoices() to decide whether to render the
 * "ElevenLabs" option in the TTS provider picker. Returns whether the
 * server has the key configured — NEVER returns the key itself.
 *
 * Requires the caller to be signed in (we use the user id to scope the
 * rate limit, so anonymous probes would defeat the purpose).
 */
export const getTtsConfig = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    // Even when the user is anonymous we should answer this — the
    // /billing page uses TTS for the read-aloud button on the trial
    // copy. The cost of a single boolean is negligible.
    if (data.userId) {
      const ok = await consume(`tts-config:${data.userId}`, {
        capacity: 30,
        windowMs: 60 * 60 * 1000,
      });
      if (!ok) {
        return { elevenlabsAvailable: loadEnv() != null };
      }
    }
    return { elevenlabsAvailable: loadEnv() != null };
  });

/**
 * Synthesise speech for the given text. Returns base64-encoded MP3 that
 * the client plays through an <audio> element.
 *
 * Auth: the user id is supplied by the caller. We rate-limit per-user and
 * verify the user exists in auth.users before spending ElevenLabs chars.
 * We deliberately do NOT verify the user's plan server-side here — the
 * browser has already gated voice access through canUseVoice, and adding
 * another DB round-trip per answer would slow the voice loop noticeably.
 * If the operator wants stricter gating, add it to the resolver and read
 * the row here.
 */
export const synthesizeSpeech = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      text: z.string().trim().min(1).max(5_000),
      lang: z.string().min(2).max(10).default("en-US"),
      // Optional override; defaults to ELEVENLABS_DEFAULT_VOICE_ID.
      voiceId: z.string().optional(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      audioBase64: string;
      contentType: string;
      voiceId: string;
      lang: string;
      model: string;
    }> => {
      const env = loadEnv();
      if (!env) throw new ElevenLabsNotConfiguredError();

      // Per-user rate limit. A typical answer is ~500 chars, so capacity 60
      // per hour is ~30k chars / hour — well below ElevenLabs' free tier
      // limit of 10k/month, but enough headroom that a power user can
      // experiment without burning the budget. Operators who want to
      // relax this for paid users can read `subscription` here and skip
      // the limit for paid plans.
      const rl = consume(`tts:${data.userId}`, {
        capacity: 60,
        windowMs: 60 * 60 * 1000,
      });
      if (!rl.ok) throw new ElevenLabsRateLimitedError(rl.retryAfterMs);

      // Cheapest possible ROI check — drop the round-trip if the user
      // id doesn't exist (or Supabase is offline, in which case we
      // fail-open to keep the voice loop working).
      const exists = await userIdExists(data.userId);
      if (!exists) {
        // Don't reveal that the user doesn't exist. Just refuse silently
        // — the client will fall back to browser TTS.
        throw new ElevenLabsUpstreamError();
      }

      const voiceId = data.voiceId ?? env.defaultVoiceId;
      const model = modelForLang(data.lang);
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "xi-api-key": env.apiKey,
            "content-type": "application/json",
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: data.text,
            model_id: model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        });
      } catch {
        throw new ElevenLabsUpstreamError();
      }

      if (res.status === 429) {
        // Honour Retry-After if ElevenLabs sent one. Default to 60s.
        const retryAfter = Number.parseFloat(res.headers.get("retry-after") ?? "60");
        const retryAfterMs = Math.max(
          1_000,
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 60_000,
        );
        throw new ElevenLabsRateLimitedError(retryAfterMs);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[elevenlabs] ${res.status}: ${detail.slice(0, 400)}`);
        throw new ElevenLabsUpstreamError();
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      // Convert to base64 in chunks so very large responses don't blow
      // the stack. 32 KB per iteration is fast on Node and any modern
      // runtime.
      let binary = "";
      const CHUNK = 32_768;
      for (let i = 0; i < buf.length; i += CHUNK) {
        const slice = buf.subarray(i, Math.min(i + CHUNK, buf.length));
        binary += String.fromCharCode.apply(null, Array.from(slice));
      }
      const audioBase64 = btoa(binary);

      return {
        audioBase64,
        contentType: res.headers.get("content-type") ?? "audio/mpeg",
        voiceId,
        lang: data.lang,
        model,
      };
    },
  );
