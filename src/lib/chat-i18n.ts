// Localized UI copy for the chat panel + Talk-with-Document workspace.
//
// What this is for:
//   - The chat panel's input placeholder, "thinking" loader, and toast
//     confirmations for Copy / Regenerate / 👍 / 👎 actions.
//   - The /talk workspace's loader and "no doc uploaded" empty state.
//
// What this is NOT for:
//   - Translating the entire product chrome (nav, billing, settings). Only
//     the chat-context strings get localized. Users who need to read the rest
//     of the UI in their language can use the browser's native translation.
//
// How it works:
//   - One entry per supported BCP-47 code, with reasonable defaults.
//   - `lookupChatCopy(code)` falls back to "en-US" when the user's `replyLang`
//     has no entry, so adding a new language never breaks the UI.
//   - `bilingualPlaceholder(code, docName)` returns a string that mixes the
//     native-script prompt with an English fallback for clarity.
//
// Adding a new language: drop a key into `CHAT_COPY` using one of the
// existing entries as a template. The fallback chain in `lookupChatCopy`
// will pick it up automatically.

export type ChatCopy = {
  // Loader inside the assistant bubble while the model thinks.
  thinking: string;
  // "Upload a document first" empty state.
  uploadFirst: string;
  // Placeholder shown inside the chat input. The `{{doc}}` slot is replaced
  // with the active document's filename (or omitted if no doc is picked).
  placeholder: string;
  // Empty state shown when the chat has no messages yet (and a doc exists).
  emptyState: string;
  // Toast shown after the Copy button is clicked.
  copied: string;
  // Tooltip for the Regenerate button (only rendered on the last assistant
  // message, when there's a preceding user question to retry).
  regenerate: string;
  // Tooltip for the thumbs-up feedback button.
  goodResponse: string;
  // Tooltip for the thumbs-down feedback button.
  badResponse: string;
};

const enUS: ChatCopy = {
  thinking: "Thinking…",
  uploadFirst: "Upload a document first, then ask again.",
  placeholder: "Ask about this document…",
  emptyState: "Ask anything about the document you uploaded.",
  copied: "Copied",
  regenerate: "Regenerate answer",
  goodResponse: "Helpful answer",
  badResponse: "Not helpful",
};

const hiIN: ChatCopy = {
  thinking: "सोच रहा है…",
  uploadFirst: "कृपया पहले एक दस्तावेज़ अपलोड करें, फिर पूछें।",
  placeholder: "इस दस्तावेज़ के बारे में पूछें…",
  emptyState: "अपलोड किए गए दस्तावेज़ के बारे में कुछ भी पूछें।",
  copied: "कॉपी हो गया",
  regenerate: "उत्तर फिर से बनाएँ",
  goodResponse: "उपयोगी उत्तर",
  badResponse: "उपयोगी नहीं था",
};

const bnIN: ChatCopy = {
  thinking: "ভাবছে…",
  uploadFirst: "প্রথমে একটি নথি আপলোড করুন, তারপর জিজ্ঞাসা করুন।",
  placeholder: "এই নথি সম্পর্কে জিজ্ঞাসা করুন…",
  emptyState: "আপলোড করা নথি সম্পর্কে যেকোনো প্রশ্ন করুন।",
  copied: "কপি হয়েছে",
  regenerate: "উত্তর পুনরায় তৈরি করুন",
  goodResponse: "সহায়ক উত্তর",
  badResponse: "সহায়ক ছিল না",
};

const taIN: ChatCopy = {
  thinking: "சிந்திக்கிறது…",
  uploadFirst: "முதலில் ஆவணத்தை பதிவேற்றவும், பிறகு கேள்வி கேளுங்கள்.",
  placeholder: "இந்த ஆவணம் பற்றி கேளுங்கள்…",
  emptyState: "பதிவேற்றிய ஆவணம் பற்றி எதையும் கேளுங்கள்.",
  copied: "நகலெடுத்தது",
  regenerate: "பதிலை மீண்டும் உருவாக்கு",
  goodResponse: "பயனுள்ள பதில்",
  badResponse: "பயனுள்ளதாக இல்லை",
};

const teIN: ChatCopy = {
  thinking: "ఆలోచిస్తోంది…",
  uploadFirst: "ముందుగా ఒక పత్రాన్ని అప్‌లోడ్ చేయండి, ఆ తర్వాత అడగండి.",
  placeholder: "ఈ పత్రం గురించి అడగండి…",
  emptyState: "మీరు అప్‌లోడ్ చేసిన పత్రం గురించి ఏదైనా అడగండి.",
  copied: "కాపీ అయింది",
  regenerate: "సమాధానాన్ని మళ్లీ రూపొందించండి",
  goodResponse: "ఉపయోగకరమైన సమాధానం",
  badResponse: "ఉపయోగకరం కాదు",
};

const knIN: ChatCopy = {
  thinking: "ಯೋಚಿಸುತ್ತಿದೆ…",
  uploadFirst: "ಮೊದಲು ಒಂದು ದಾಖಲೆಯನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ನಂತರ ಕೇಳಿ.",
  placeholder: "ಈ ದಾಖಲೆಯ ಬಗ್ಗೆ ಕೇಳಿ…",
  emptyState: "ನೀವು ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ದಾಖಲೆಯ ಬಗ್ಗೆ ಏನಾದರೂ ಕೇಳಿ.",
  copied: "ನಕಲಿಸಲಾಗಿದೆ",
  regenerate: "ಉತ್ತರವನ್ನು ಮತ್ತೆ ರಚಿಸಿ",
  goodResponse: "ಉಪಯುಕ್ತ ಉತ್ತರ",
  badResponse: "ಉಪಯುಕ್ತವಲ್ಲ",
};

const mlIN: ChatCopy = {
  thinking: "ചിന്തിക്കുന്നു…",
  uploadFirst: "ആദ്യം ഒരു രേഖ അപ്‌ലോഡ് ചെയ്യുക, പിന്നെ ചോദിക്കുക.",
  placeholder: "ഈ രേഖയെക്കുറിച്ച് ചോദിക്കൂ…",
  emptyState: "നിങ്ങൾ അപ്‌ലോഡ് ചെയ്ത രേഖയെക്കുറിച്ച് എന്തെങ്കിലും ചോദിക്കൂ.",
  copied: "കോപ്പിയായി",
  regenerate: "ഉത്തരം വീണ്ടും സൃഷ്ടിക്കുക",
  goodResponse: "സഹായകമായ ഉത്തരം",
  badResponse: "സഹായകമല്ല",
};

const mrIN: ChatCopy = {
  thinking: "विचार करत आहे…",
  uploadFirst: "कृपया प्रथम एक दस्तऐवज अपलोड करा, नंतर विचारा.",
  placeholder: "या दस्तऐवजाबद्दल विचारा…",
  emptyState: "आपण अपलोड केलेल्या दस्तऐवजाबद्दल काहीही विचारा.",
  copied: "कॉपी झाले",
  regenerate: "उत्तर पुन्हा तयार करा",
  goodResponse: "उपयुक्त उत्तर",
  badResponse: "उपयुक्त नव्हते",
};

const guIN: ChatCopy = {
  thinking: "વિચારી રહ્યું છે…",
  uploadFirst: "કૃપા કરીને પહેલાં એક દસ્તાવેજ અપલોડ કરો, પછી પૂછો.",
  placeholder: "આ દસ્તાવેજ વિશે પૂછો…",
  emptyState: "તમે અપલોડ કરેલા દસ્તાવેજ વિશે કંઈપણ પૂછો.",
  copied: "કૉપિ થઈ ગયું",
  regenerate: "જવાબ ફરી બનાવો",
  goodResponse: "ઉપયોગી જવાબ",
  badResponse: "ઉપયોગી નહોતું",
};

const paIN: ChatCopy = {
  thinking: "ਸੋਚ ਰਿਹਾ ਹੈ…",
  uploadFirst: "ਕਿਰਪਾ ਕਰਕੇ ਪਹਿਲਾਂ ਇੱਕ ਦਸਤਾਵੇਜ਼ ਅੱਪਲੋਡ ਕਰੋ, ਫਿਰ ਪੁੱਛੋ।",
  placeholder: "ਇਸ ਦਸਤਾਵੇਜ਼ ਬਾਰੇ ਪੁੱਛੋ…",
  emptyState: "ਤੁਹਾਡੇ ਵੱਲੋਂ ਅੱਪਲੋਡ ਕੀਤੇ ਦਸਤਾਵੇਜ਼ ਬਾਰੇ ਕੁਝ ਵੀ ਪੁੱਛੋ।",
  copied: "ਕਾਪੀ ਹੋ ਗਿਆ",
  regenerate: "ਜਵਾਬ ਮੁੜ ਬਣਾਓ",
  goodResponse: "ਮਦਦਗਾਰ ਜਵਾਬ",
  badResponse: "ਮਦਦਗਾਰ ਨਹੀਂ ਸੀ",
};

const orIN: ChatCopy = {
  thinking: "ଚିନ୍ତା କରୁଛି…",
  uploadFirst: "ଦୟାକରି ପ୍ରଥମେ ଗୋଟିଏ ଦସ୍ତାବେଜ ଅପଲୋଡ୍ କରନ୍ତୁ, ତା'ପରେ ପଚାରନ୍ତୁ।",
  placeholder: "ଏହି ଦସ୍ତାବେଜ ବିଷୟରେ ପଚାରନ୍ତୁ…",
  emptyState: "ଆପଣ ଅପଲୋଡ୍ କରିଥିବା ଦସ୍ତାବେଜ ବିଷୟରେ କିଛି ପଚାରନ୍ତୁ।",
  copied: "କପି ହୋଇଗଲା",
  regenerate: "ଉତ୍ତର ପୁଣି ତିଆରି କରନ୍ତୁ",
  goodResponse: "ଉପଯୋଗୀ ଉତ୍ତର",
  badResponse: "ଉପଯୋଗୀ ନୁହେଁ",
};

const asIN: ChatCopy = {
  thinking: "চিন্তা কৰিছে…",
  uploadFirst: "প্ৰথমে এটা নথি আপলোড কৰক, তাৰ পিছত সুধক।",
  placeholder: "এই নথিৰ বিষয়ে সুধক…",
  emptyState: "আপুনি আপলোড কৰা নথিৰ বিষয়ে যি খন সুধিব পাৰে।",
  copied: "প্ৰতিলিপি হ'ল",
  regenerate: "উত্তৰ পুনৰ সৃষ্টি কৰক",
  goodResponse: "সহায়ক উত্তৰ",
  badResponse: "সহায়ক নহয়",
};

const urIN: ChatCopy = {
  thinking: "سوچ رہا ہے…",
  uploadFirst: "پہلے ایک دستاویز اپ لوڈ کریں، پھر پوچھیں۔",
  placeholder: "اس دستاویز کے بارے میں پوچھیں…",
  emptyState: "اپ لوڈ کردہ دستاویز کے بارے میں کچھ بھی پوچھیں۔",
  copied: "کاپی ہو گیا",
  regenerate: "جواب دوبارہ بنائیں",
  goodResponse: "مددگار جواب",
  badResponse: "مددگار نہیں تھا",
};

const esES: ChatCopy = {
  thinking: "Pensando…",
  uploadFirst: "Sube primero un documento y vuelve a preguntar.",
  placeholder: "Pregunta sobre este documento…",
  emptyState: "Pregunta lo que quieras sobre el documento que subiste.",
  copied: "Copiado",
  regenerate: "Regenerar respuesta",
  goodResponse: "Respuesta útil",
  badResponse: "No fue útil",
};

const frFR: ChatCopy = {
  thinking: "Réflexion…",
  uploadFirst: "Téléversez d'abord un document, puis réessayez.",
  placeholder: "Posez une question sur ce document…",
  emptyState: "Posez n'importe quelle question sur le document téléversé.",
  copied: "Copié",
  regenerate: "Régénérer la réponse",
  goodResponse: "Réponse utile",
  badResponse: "Pas utile",
};

const deDE: ChatCopy = {
  thinking: "Denke nach…",
  uploadFirst: "Lade zuerst ein Dokument hoch und versuche es dann erneut.",
  placeholder: "Frage zu diesem Dokument stellen…",
  emptyState: "Stelle eine beliebige Frage zum hochgeladenen Dokument.",
  copied: "Kopiert",
  regenerate: "Antwort neu generieren",
  goodResponse: "Hilfreiche Antwort",
  badResponse: "Nicht hilfreich",
};

const ptBR: ChatCopy = {
  thinking: "Pensando…",
  uploadFirst: "Envie um documento primeiro e pergunte de novo.",
  placeholder: "Pergunte sobre este documento…",
  emptyState: "Pergunte qualquer coisa sobre o documento enviado.",
  copied: "Copiado",
  regenerate: "Regenerar resposta",
  goodResponse: "Resposta útil",
  badResponse: "Não foi útil",
};

const arSA: ChatCopy = {
  thinking: "جارٍ التفكير…",
  uploadFirst: "حمّل مستنداً أولاً، ثم اسأل مرة أخرى.",
  placeholder: "اسأل عن هذا المستند…",
  emptyState: "اسأل أي شيء عن المستند الذي حمّلته.",
  copied: "تم النسخ",
  regenerate: "أعد توليد الإجابة",
  goodResponse: "إجابة مفيدة",
  badResponse: "ليست مفيدة",
};

export const CHAT_COPY: Record<string, ChatCopy> = {
  "en-US": enUS,
  "hi-IN": hiIN,
  "bn-IN": bnIN,
  "ta-IN": taIN,
  "te-IN": teIN,
  "kn-IN": knIN,
  "ml-IN": mlIN,
  "mr-IN": mrIN,
  "gu-IN": guIN,
  "pa-IN": paIN,
  "or-IN": orIN,
  "as-IN": asIN,
  "ur-IN": urIN,
  "es-ES": esES,
  "fr-FR": frFR,
  "de-DE": deDE,
  "pt-BR": ptBR,
  "ar-SA": arSA,
};

/**
 * Look up the chat copy for a language code. Falls back to "en-US" when
 * the language isn't in the table — this is the only safe default because
 * the user-facing strings must always render, even for langs we haven't
 * localized yet.
 */
export function lookupChatCopy(code: string): ChatCopy {
  return CHAT_COPY[code] ?? enUS;
}

/**
 * Build a chat-input placeholder. When `replyLang` isn't English, the
 * native-script prompt is shown first and the English fallback comes
 * after a separator. The docName (when provided) is appended so the user
 * knows which document the placeholder refers to.
 *
 * English: "Ask about this document…"
 * Hindi with no doc: "इस दस्तावेज़ के बारे में पूछें… or Ask about this document…"
 * Hindi with "notes.pdf": "इस दस्तावेज़ के बारे में पूछें… or Ask about notes.pdf…"
 */
export function bilingualPlaceholder(replyLang: string, docName?: string): string {
  const copy = lookupChatCopy(replyLang);
  const native = copy.placeholder;
  const enText = "Ask about this document…";
  const enWithDoc = docName ? `Ask about ${docName}…` : enText;
  // English copy → no bilingual doubling.
  if (replyLang === "en-US") {
    return docName ? `Ask about ${docName}…` : enText;
  }
  const nativeWithDoc = docName ? native.replace("…", ` (${docName})…`) : native;
  // Avoid duplicating the English half when the native placeholder is already
  // descriptive enough — but most native placeholders just say "Ask about
  // this document…", so the bilingual doubling helps clarity.
  return `${nativeWithDoc} or ${enWithDoc}`;
}
