// Language detection from document text.
//
// Pure helper — usable from any surface (chat panel, /talk workspace, serverFn).
// Returns a BCP-47 code (e.g. "hi-IN", "en-US") based on a Unicode-script
// heuristic over the first ~2 KB of joined chunks.
//
// The heuristic scans the first ~600 significant characters (whitespace /
// ASCII punctuation stripped) and counts Unicode character ranges. The
// script with the highest count wins. Latin defaults to "en-US" since we
// can't disambiguate Spanish from English from Portuguese without a heavier
// model — the user can override via the language picker at any time.
//
// All 22 scheduled languages of India are covered. Where two languages share
// the same script (e.g. Hindi/Marathi/Sanskrit in Devanagari, Urdu/Sindhi in
// Perso-Arabic) we map to the most common member of the family. This is a
// deliberate simplification: the script is the only signal available without
// a heavier model, and the chat panel lets the user pick a specific dialect
// at any time. The intent is "pick something close", not "be perfectly right."

type DocLike = { chunks: string[] };

export function detectLangFromDocs(docs: DocLike[] | undefined | null): string {
  if (!docs || docs.length === 0) return "en-US";
  const sample = docs[0].chunks.join(" ").slice(0, 2000);
  // Strip whitespace + ASCII punctuation so the script counts aren't
  // dominated by formatting.
  const stripped = sample.replace(/[\s\d\p{P}]/gu, "");
  if (stripped.length === 0) return "en-US";

  const scripts: Record<string, number> = {
    devanagari: 0, // hi, mr, ne, sa, brx, doi, kok, mai (default: hi)
    bengali: 0, // bn, as (default: bn)
    telugu: 0,
    tamil: 0,
    kannada: 0,
    malayalam: 0,
    gujarati: 0,
    gurmukhi: 0, // pa
    oriya: 0, // or
    arabic: 0, // ur, sd, ks, fa (default: ur — Indian-Arabic fallback)
    meeteiMayek: 0, // mni
    olChiki: 0, // sat
    cyrillic: 0, // ru, uk, bg
    han: 0, // zh
    hiragana: 0, // ja
    katakana: 0, // ja
    hangul: 0, // ko
    latin: 0,
  };

  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0900 && code <= 0x097f) scripts.devanagari++;
    else if (code >= 0x0980 && code <= 0x09ff) scripts.bengali++;
    else if (code >= 0x0c00 && code <= 0x0c7f) scripts.telugu++;
    else if (code >= 0x0b80 && code <= 0x0bff) scripts.tamil++;
    else if (code >= 0x0c80 && code <= 0x0cff) scripts.kannada++;
    else if (code >= 0x0d00 && code <= 0x0d7f) scripts.malayalam++;
    else if (code >= 0x0a80 && code <= 0x0aff) scripts.gujarati++;
    else if (code >= 0x0a00 && code <= 0x0a7f) scripts.gurmukhi++;
    else if (code >= 0x0b00 && code <= 0x0b7f) scripts.oriya++;
    else if (code >= 0x0600 && code <= 0x06ff) scripts.arabic++;
    // Meitei Mayek: U+ABC0–U+ABFF (mni-IN)
    else if (code >= 0xabc0 && code <= 0xabff) scripts.meeteiMayek++;
    // Ol Chiki: U+1C50–U+1C7F (sat-IN)
    else if (code >= 0x1c50 && code <= 0x1c7f) scripts.olChiki++;
    else if (code >= 0x0400 && code <= 0x04ff) scripts.cyrillic++;
    else if (code >= 0x4e00 && code <= 0x9fff) scripts.han++;
    else if (code >= 0x3040 && code <= 0x309f) scripts.hiragana++;
    else if (code >= 0x30a0 && code <= 0x30ff) scripts.katakana++;
    else if (code >= 0xac00 && code <= 0xd7af) scripts.hangul++;
    else if (code >= 0x0041 && code <= 0x007a) scripts.latin++;
  }

  const winner = Object.entries(scripts).sort((a, b) => b[1] - a[1])[0];
  if (!winner || winner[1] === 0) return "en-US";
  switch (winner[0]) {
    case "devanagari":
      // Default to Hindi; user can switch to mr-IN / ne-IN / sa-IN via picker.
      return "hi-IN";
    case "bengali":
      // Bengali is the dominant Bengali-script language in our picker.
      return "bn-IN";
    case "telugu":
      return "te-IN";
    case "tamil":
      return "ta-IN";
    case "kannada":
      return "kn-IN";
    case "malayalam":
      return "ml-IN";
    case "gujarati":
      return "gu-IN";
    case "gurmukhi":
      return "pa-IN";
    case "oriya":
      return "or-IN";
    case "arabic":
      // Indian-Arabic scripts default to Urdu; users uploading pure Arabic
      // can flip the picker to ar-SA. Same heuristic pre-existed for the
      // /talk workspace — just made the Indian-script default explicit.
      return "ur-IN";
    case "meeteiMayek":
      return "mni-IN";
    case "olChiki":
      return "sat-IN";
    case "cyrillic":
      return "ru-RU";
    case "han":
      return "zh-CN";
    case "hiragana":
    case "katakana":
      return "ja-JP";
    case "hangul":
      return "ko-KR";
    case "latin":
    default:
      return "en-US";
  }
}

/**
 * Same heuristic but operates on a raw joined string (used by the serverFn
 * `askChat` which only sees the pre-scored chunks the client forwarded).
 */
export function detectLangFromText(text: string): string {
  return detectLangFromDocs([{ chunks: [text] }]);
}
