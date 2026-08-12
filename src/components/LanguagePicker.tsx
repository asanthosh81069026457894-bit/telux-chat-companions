// BCP-47 language picker — used by both /talk (next to VoicePicker) and the
// chat panel (next to the Chat header). The user's pick persists to
// localStorage via useVoices() so the two surfaces stay in sync.
//
// Why a shared component:
//   - The user changes language in one place and expects it to apply
//     everywhere that talks (chat read-aloud, /talk STT/TTS).
//   - Identical styling avoids drift between the two surfaces.
//
// "Auto" deliberately isn't an option — the document-detection heuristic
// in detectLangFromDocs() already runs in /talk and falls back to "en-US"
// when no document is loaded. The picker overrides that detection
// completely once the user picks something other than the default.
//
// Grouped layout:
//   The 29-entry list is split into three sections ("English", "Indic (22)",
//   "Other") with sticky dividers so the user can scan the list quickly.
//   Each row shows the English label + native-script label; a small dot on
//   the right indicates voice quality (`strong` / `partial` / `limited`)
//   with a tooltip explaining what to expect. Quality is informational only —
//   the runtime always tries ElevenLabs first and falls back to browser TTS.

import { Languages } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SUPPORTED_LANGS, qualityForLang, useVoices, type SupportedLang } from "@/hooks/useVoices";

const QUALITY_DOT: Record<SupportedLang["quality"], string> = {
  strong: "bg-emerald-500",
  partial: "bg-amber-500",
  limited: "bg-rose-500",
};

const QUALITY_TOOLTIP: Record<SupportedLang["quality"], string> = {
  strong: "Full voice support — sounds natural in this language.",
  partial: "May fall back to a generic voice — read-aloud still works.",
  limited: "Limited voice support — best-effort, may sound unclear.",
};

type Section = { title: string; items: SupportedLang[] };

function partitionLangs(): Section[] {
  // SUPPORTED_LANGS is already ordered English → Indic (22) → Other.
  // We classify each entry against the Indic set; everything else is "Other".
  const english: SupportedLang[] = [];
  const indic: SupportedLang[] = [];
  const other: SupportedLang[] = [];
  for (const l of SUPPORTED_LANGS) {
    if (l.code === "en-US") english.push(l);
    else if (INDIC_CODES.has(l.code)) indic.push(l);
    else other.push(l);
  }
  return [
    { title: "English", items: english },
    { title: `Indic (${indic.length})`, items: indic },
    { title: "Other", items: other },
  ];
}

// The 22 scheduled languages of India. Matches the Indic entries in
// SUPPORTED_LANGS (and the plan's source-of-truth table in the chat-detect-lang
// memory).
const INDIC_CODES = new Set([
  "as-IN",
  "bn-IN",
  "brx-IN",
  "doi-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ks-IN",
  "kok-IN",
  "mai-IN",
  "ml-IN",
  "mni-IN",
  "mr-IN",
  "ne-IN",
  "or-IN",
  "pa-IN",
  "sa-IN",
  "sat-IN",
  "sd-IN",
  "ta-IN",
  "te-IN",
  "ur-IN",
]);

export function LanguagePicker() {
  const { lang, setLang } = useVoices();
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
  const current = SUPPORTED_LANGS.find((o) => o.code === lang) ?? SUPPORTED_LANGS[0];
  const sections = useMemo(() => partitionLangs(), []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose language"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <Languages className="size-3.5" />
        <span className="hidden sm:inline">{current?.label ?? "English"}</span>
        <span className="sm:hidden">{current?.native ?? "EN"}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute right-0 top-full z-30 mt-1 max-h-80 min-w-[220px] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface shadow-2xl"
        >
          {sections.map((section, sIdx) => (
            <li key={section.title} role="presentation">
              {sIdx > 0 ? (
                <div className="border-t border-border bg-surface-2/60 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </div>
              ) : (
                <div className="bg-surface-2/60 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </div>
              )}
              <ul role="group">
                {section.items.map((o) => {
                  const q = qualityForLang(o.code);
                  const tip = QUALITY_TOOLTIP[q];
                  return (
                    <li key={o.code} role="option" aria-selected={lang === o.code}>
                      <button
                        type="button"
                        onClick={() => {
                          setLang(o.code);
                          setOpen(false);
                        }}
                        title={tip}
                        className={
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors " +
                          (lang === o.code
                            ? "bg-signal/15 font-semibold text-signal"
                            : "text-foreground hover:bg-surface-2")
                        }
                      >
                        <span className="flex items-center gap-2">
                          <span>{o.label}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {o.native}
                          </span>
                        </span>
                        <span
                          className={"size-1.5 shrink-0 rounded-full " + QUALITY_DOT[q]}
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
