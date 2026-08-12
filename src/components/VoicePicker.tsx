// Three-position voice-gender dropdown: Auto / Female / Male.
//
// Extracted from src/routes/talk.tsx so the same picker can mount in:
//   - The Talk-with-Document header (existing call site).
//   - The dashboard sub-nav header (new).
//   - Anywhere else that wants the user's voice preference.
//
// The user's choice persists to localStorage["telux:voice-gender"] via
// `useVoices().setGender`, which is also read by `useSpeech` (chat
// read-aloud) and `useMaaraSession` (Talk-with-Document). Picking "Male"
// here flips both surfaces simultaneously.
//
// Hides gracefully when SpeechSynthesis is unavailable (no point offering
// a voice picker on a server without TTS). The picker uses a button + popup
// pattern identical to `LanguagePicker` for visual consistency.

import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useVoices, type VoiceGender } from "@/hooks/useVoices";

const OPTS: Array<{ value: VoiceGender; label: string; emoji: string }> = [
  { value: "auto", label: "Auto", emoji: "✨" },
  { value: "female", label: "Female", emoji: "👩" },
  { value: "male", label: "Male", emoji: "👨" },
];

export function VoicePicker() {
  const { supported, gender, setGender } = useVoices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!supported) return null;

  const current = OPTS.find((o) => o.value === gender) ?? OPTS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose voice gender"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <Volume2 className="size-3.5" />
        <span className="hidden sm:inline">{current?.label ?? "Auto"}</span>
        <span className="sm:hidden">{current?.emoji ?? "✨"}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Voice gender"
          className="absolute right-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        >
          {OPTS.map((o) => (
            <li key={o.value} role="option" aria-selected={gender === o.value}>
              <button
                type="button"
                onClick={() => {
                  setGender(o.value);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors " +
                  (gender === o.value
                    ? "bg-signal/15 font-semibold text-signal"
                    : "text-foreground hover:bg-surface-2")
                }
              >
                <span aria-hidden>{o.emoji}</span>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
