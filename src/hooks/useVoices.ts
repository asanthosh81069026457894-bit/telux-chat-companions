// Browser SpeechSynthesis voice list + voice-gender + language pickers.
//
// `window.speechSynthesis.getVoices()` returns `[]` on the first call in
// Chrome and some Chromium-based browsers; the real list arrives a moment
// later via the `voiceschanged` event. This hook reads immediately, then
// subscribes to the event so the dropdowns in the Talk-with-Document workspace
// eventually populate. Safe on browsers that don't support speechSynthesis —
// returns an empty list and warns once.
//
// Three pieces of user preference live here, all persisted to localStorage so
// the chat panel and /talk stay in sync:
//   1. gender       (auto / female / male) — pickVoiceForLang() honours it
//   2. lang         (BCP-47, default "en-US") — drives both STT and TTS
//   3. ttsProvider  ("browser" / "elevenlabs") — when ElevenLabs is
//      configured, we prefer it (much better voices for hi-IN / ta-IN / etc.);
//      "browser" falls back to the OS SpeechSynthesis voices.
//
// Gender picker: `SpeechSynthesisVoice.gender` is non-standard (Chrome only).
// We fall back to a name-matching heuristic so the user can pick "Female" /
// "Male" / "Auto" and we still find a sensible voice on macOS, iOS, Windows,
// Android, and Linux. The fallback chain in `pickVoiceForLang` is:
//   1. exact lang + gender hint (name contains "female"/"woman"/"karen"/etc.)
//   2. exact lang + any gender
//   3. lang prefix + gender hint
//   4. lang prefix + any gender
//   5. OS default voice

import { useCallback, useEffect, useState } from "react";

export type VoiceGender = "auto" | "female" | "male";

export type TtsProvider = "browser" | "elevenlabs";

// Languages we surface in the picker.
//
// All 22 scheduled languages of India (per the Eighth Schedule of the
// Constitution) are included — the chat model understands them, document
// detection recognises their scripts, and ElevenLabs Multilingual v2 has
// voices for almost all of them. OS SpeechSynthesis support is patchy for
// the less-common scripts; we mark those `quality: "limited"` so the picker
// can show a tooltip explaining that the OS voice may fall back to a
// generic one. English + 6 European/Arabic languages round out the list.
//
// `quality` is a UI hint only — the runtime always tries ElevenLabs first
// (when configured) and falls back to browser TTS otherwise. The user's
// pick is the source of truth; the badge is honesty about what will
// actually be heard.
export type LangQuality = "strong" | "partial" | "limited";

export type SupportedLang = {
  // BCP-47 code, e.g. "hi-IN".
  code: string;
  // English label (used in the dropdown).
  label: string;
  // Native-script label (used in the dropdown + language-indicator badge).
  native: string;
  // Quality hint for STT/TTS. Drives the tooltip text in LanguagePicker.
  quality: LangQuality;
};

export const SUPPORTED_LANGS: SupportedLang[] = [
  // English — default
  { code: "en-US", label: "English", native: "English", quality: "strong" },

  // Indic — all 22 scheduled languages of India (Eighth Schedule).
  // Strong = OS voice + ElevenLabs; Partial = OS may lack voice but
  // ElevenLabs multilingual v2 covers it; Limited = script-level support,
  // may need to fall back to a generic voice or to the English model.
  { code: "as-IN", label: "Assamese", native: "অসমীয়া", quality: "partial" },
  { code: "bn-IN", label: "Bengali", native: "বাংলা", quality: "strong" },
  { code: "brx-IN", label: "Bodo", native: "बड़ो", quality: "limited" },
  { code: "doi-IN", label: "Dogri", native: "डोगरी", quality: "limited" },
  { code: "gu-IN", label: "Gujarati", native: "ગુજરાતી", quality: "strong" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी", quality: "strong" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ", quality: "strong" },
  { code: "ks-IN", label: "Kashmiri", native: "کأشُر", quality: "partial" },
  { code: "kok-IN", label: "Konkani", native: "कोंकणी", quality: "partial" },
  { code: "mai-IN", label: "Maithili", native: "मैथिली", quality: "partial" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം", quality: "strong" },
  { code: "mni-IN", label: "Manipuri (Meitei)", native: "মৈতৈলোন্", quality: "limited" },
  { code: "mr-IN", label: "Marathi", native: "मराठी", quality: "strong" },
  { code: "ne-IN", label: "Nepali", native: "नेपाली", quality: "partial" },
  { code: "or-IN", label: "Odia", native: "ଓଡ଼ିଆ", quality: "partial" },
  { code: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ", quality: "strong" },
  { code: "sa-IN", label: "Sanskrit", native: "संस्कृतम्", quality: "partial" },
  { code: "sat-IN", label: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", quality: "limited" },
  { code: "sd-IN", label: "Sindhi", native: "سنڌي", quality: "partial" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்", quality: "strong" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు", quality: "strong" },
  { code: "ur-IN", label: "Urdu", native: "اردو", quality: "partial" },

  // Other — European + Arabic (non-Indic Arabic fallback)
  { code: "es-ES", label: "Spanish", native: "Español", quality: "strong" },
  { code: "fr-FR", label: "French", native: "Français", quality: "strong" },
  { code: "de-DE", label: "German", native: "Deutsch", quality: "strong" },
  { code: "pt-BR", label: "Portuguese", native: "Português", quality: "strong" },
  { code: "ar-SA", label: "Arabic", native: "العربية", quality: "strong" },
  { code: "ru-RU", label: "Russian", native: "Русский", quality: "partial" },
  { code: "zh-CN", label: "Chinese (Simplified)", native: "中文", quality: "partial" },
  { code: "ja-JP", label: "Japanese", native: "日本語", quality: "strong" },
  { code: "ko-KR", label: "Korean", native: "한국어", quality: "partial" },
];

export const DEFAULT_LANG = "en-US";

/** Look up a supported language entry by code; falls back to en-US. */
export function getSupportedLang(code: string): SupportedLang {
  return SUPPORTED_LANGS.find((l) => l.code === code) ?? SUPPORTED_LANGS[0]!;
}

/** Native-script label for a code; never throws. */
export function nativeForLang(code: string): string {
  return getSupportedLang(code).native;
}

/** Quality hint for the UI tooltip. */
export function qualityForLang(code: string): LangQuality {
  return getSupportedLang(code).quality;
}

export type VoiceOption = {
  // BCP-47 lang code, e.g. "en-US", "hi-IN".
  lang: string;
  // Short prefix for grouping, e.g. "en", "hi".
  prefix: string;
  // Human label shown in the dropdown.
  label: string;
  // Best-effort gender hint derived from voice.name. Used by the picker so
  // we can show "Female" / "Male" in the dropdown instead of raw names.
  gender: VoiceGender;
  voice: SpeechSynthesisVoice;
};

const GENDER_STORAGE_KEY = "telux:voice-gender";
const LANG_STORAGE_KEY = "telux:voice-lang";
const TTS_PROVIDER_STORAGE_KEY = "telux:tts-provider";

function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

// Heuristic gender detection from the voice's display name. The W3C spec
// doesn't expose a gender field, so we pattern-match the names that ship
// with every major OS. This list is intentionally broad; unknown names
// return "auto" and fall through to the first available voice in the lang.
const FEMALE_HINTS = [
  "female",
  "woman",
  "girl",
  "karen",
  "samantha",
  "victoria",
  "allison",
  "ava",
  "fiona",
  "moira",
  "tessa",
  "veena",
  "fema",
  "milena",
  "yuri",
  "zira",
  "susan",
  "kathy",
  "paulina",
  "monica",
  "amelie",
  "anna",
  "sara",
  "maria",
  "jenny",
];
const MALE_HINTS = [
  "male",
  "man",
  "guy",
  "daniel",
  "alex",
  "fred",
  "tom",
  "aaron",
  "rishi",
  "prabhat",
  "david",
  "oliver",
  "lee",
  "giorgio",
  "luca",
  "diego",
  "jorge",
  "thomas",
  "ricardo",
];

function hintForVoiceName(name: string): VoiceGender {
  const n = name.toLowerCase();
  if (FEMALE_HINTS.some((h) => n.includes(h))) return "female";
  if (MALE_HINTS.some((h) => n.includes(h))) return "male";
  return "auto";
}

function mapVoices(voices: SpeechSynthesisVoice[]): VoiceOption[] {
  // Dedupe by lang + name (Chrome can return duplicate entries).
  const seen = new Set<string>();
  const out: VoiceOption[] = [];
  for (const v of voices) {
    const key = `${v.lang}::${v.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      lang: v.lang,
      prefix: v.lang.split("-")[0] ?? v.lang,
      label: `${v.name} (${v.lang})`,
      gender: hintForVoiceName(v.name),
      voice: v,
    });
  }
  // Sort: English first, then alphabetical by lang for stability.
  out.sort((a, b) => {
    if (a.prefix === "en" && b.prefix !== "en") return -1;
    if (b.prefix === "en" && a.prefix !== "en") return 1;
    return a.lang.localeCompare(b.lang);
  });
  return out;
}

/**
 * The hook's return shape. `lang` is the user's manual pick (default
 * "en-US"); `ttsProvider` is the active TTS engine.
 */
export type UseVoicesResult = {
  // Browser TTS support — false on iOS Safari in some embedded contexts, etc.
  supported: boolean;
  voices: VoiceOption[];
  gender: VoiceGender;
  setGender: (g: VoiceGender) => void;
  lang: string;
  setLang: (lang: string) => void;
  // The active TTS provider. "elevenlabs" when ELEVENLABS_API_KEY is set AND
  // the user has not forced "browser"; otherwise "browser".
  ttsProvider: TtsProvider;
  setTtsProvider: (p: TtsProvider) => void;
  // True when the server has an ELEVENLABS_API_KEY configured. The /talk
  // header hides the provider toggle when this is false so the user is not
  // offered a feature that doesn't work.
  elevenlabsAvailable: boolean;
};

export function useVoices(): UseVoicesResult {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [gender, setGenderState] = useState<VoiceGender>("auto");
  const [lang, setLangState] = useState<string>(DEFAULT_LANG);
  // Default the TTS provider to "browser" until we know the server has an
  // ElevenLabs key. The boot effect below flips it when the server confirms.
  const [ttsProvider, setTtsProviderState] = useState<TtsProvider>("browser");
  const [elevenlabsAvailable, setElevenlabsAvailable] = useState<boolean>(false);
  const supported = isSpeechSynthesisAvailable();

  // Read persisted preferences on mount (client-only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const g = window.localStorage.getItem(GENDER_STORAGE_KEY);
      if (g === "female" || g === "male" || g === "auto") setGenderState(g);
      const l = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (l && SUPPORTED_LANGS.some((opt) => opt.code === l)) setLangState(l);
      const p = window.localStorage.getItem(TTS_PROVIDER_STORAGE_KEY);
      if (p === "browser" || p === "elevenlabs") setTtsProviderState(p);
    } catch {
      /* ignore quota / disabled storage */
    }
  }, []);

  // Ask the server whether ElevenLabs is configured. A simple boolean so the
  // serverFn doesn't leak the key. Cached for the session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getTtsConfig } = await import("@/serverFns/tts");
        const cfg = await getTtsConfig({ data: {} });
        if (cancelled) return;
        setElevenlabsAvailable(cfg.elevenlabsAvailable);
        // If the persisted choice was "elevenlabs" but the server no longer
        // has a key, fall back to browser. The reverse (browser → elevenlabs)
        // we don't auto-flip, the user opted in for a reason.
        if (!cfg.elevenlabsAvailable && ttsProvider === "elevenlabs") {
          setTtsProviderState("browser");
        }
      } catch {
        // Backend offline / function not yet shipped. Treat as no ElevenLabs.
        if (!cancelled) setElevenlabsAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally only run this once per mount; the ttsProvider read
    // inside is a stale-snapshot fallback (the localStorage read on mount
    // is the source of truth).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    // Read once now (Safari/Firefox usually have the list ready immediately).
    setVoices(mapVoices(synth.getVoices()));
    // Subscribe for Chrome, which fires `voiceschanged` after first load.
    const handler = () => setVoices(mapVoices(synth.getVoices()));
    synth.addEventListener?.("voiceschanged", handler);
    return () => {
      synth.removeEventListener?.("voiceschanged", handler);
    };
  }, [supported]);

  const setGender = useCallback((g: VoiceGender) => {
    setGenderState(g);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(GENDER_STORAGE_KEY, g);
      } catch {
        /* ignore quota errors */
      }
    }
  }, []);

  const setLang = useCallback((next: string) => {
    // Reject anything we don't know about — protects the picker from being
    // fed an arbitrary string from a future refactor.
    if (!SUPPORTED_LANGS.some((opt) => opt.code === next)) return;
    setLangState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const setTtsProvider = useCallback(
    (p: TtsProvider) => {
      // Don't let the user pick "elevenlabs" when the server has no key.
      // The picker UI disables this option, but a stale click could race a
      // server removal. We belt-and-brace here.
      if (p === "elevenlabs" && !elevenlabsAvailable) return;
      setTtsProviderState(p);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, p);
        } catch {
          /* ignore */
        }
      }
    },
    [elevenlabsAvailable],
  );

  return {
    supported,
    voices,
    gender,
    setGender,
    lang,
    setLang,
    ttsProvider,
    setTtsProvider,
    elevenlabsAvailable,
  };
}

/**
 * Pick the best voice for (lang, gender). Exported so chat-panel TTS
 * (`useSpeech`) and Talk-with-Document (`useMaaraSession`) share the same
 * selection logic.
 *
 * Falls back gracefully when the gender hint has no matches — the user
 * always gets *some* voice in the requested language, never silence.
 */
export function pickVoiceForLang(
  voices: SpeechSynthesisVoice[],
  lang: string,
  gender: VoiceGender = "auto",
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const prefix = lang.split("-")[0];

  // Helper: does this voice look like the requested gender?
  const matchesGender = (v: SpeechSynthesisVoice): boolean => {
    if (gender === "auto") return true;
    const hint = hintForVoiceName(v.name);
    return hint === gender || hint === "auto";
  };

  // 1) Exact lang + gender hint
  const exactGender = voices.find((v) => v.lang === lang && matchesGender(v));
  if (exactGender) return exactGender;
  // 2) Exact lang, any gender
  const exactAny = voices.find((v) => v.lang === lang);
  if (exactAny) return exactAny;
  // 3) Lang prefix + gender hint
  const fuzzyGender = voices.find(
    (v) => (v.lang.startsWith(prefix + "-") || v.lang === prefix) && matchesGender(v),
  );
  if (fuzzyGender) return fuzzyGender;
  // 4) Lang prefix, any gender
  const fuzzyAny = voices.find((v) => v.lang.startsWith(prefix + "-") || v.lang === prefix);
  if (fuzzyAny) return fuzzyAny;
  // 5) OS default
  return voices[0] ?? null;
}
