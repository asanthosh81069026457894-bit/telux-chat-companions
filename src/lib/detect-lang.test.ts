// Unit tests for the script-based language detector. Run with:
//   node --test --experimental-strip-types src/lib/detect-lang.test.ts
//
// Covers every script the detector knows about (incl. Meitei Mayek and
// Ol Chiki for the full 22-scheduled-language surface) plus the
// edge cases: empty input, pure ASCII / Latin, and a mixed-script doc.

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectLangFromText, detectLangFromDocs } from "./detect-lang.ts";

test("empty input → en-US", () => {
  assert.equal(detectLangFromText(""), "en-US");
  assert.equal(detectLangFromText("   \n  "), "en-US");
});

test("pure Latin → en-US", () => {
  assert.equal(
    detectLangFromText("The quick brown fox jumps over the lazy dog. Hello world."),
    "en-US",
  );
});

test("Latin with diacritics still defaults to en-US (heuristic)", () => {
  // Spanish/French/German all share Latin. We deliberately don't try to
  // disambiguate at the script level — the user picks via the picker.
  assert.equal(detectLangFromText("Hola, ¿cómo estás? Bienvenue à Paris."), "en-US");
});

test("Devanagari → hi-IN", () => {
  assert.equal(
    detectLangFromText("यह एक हिंदी वाक्य है जिसका उपयोग परीक्षण के लिए किया जाता है।"),
    "hi-IN",
  );
});

test("Bengali → bn-IN", () => {
  assert.equal(
    detectLangFromText("এটি একটি বাংলা বাক্য যা পরীক্ষার জন্য ব্যবহার করা হয়।"),
    "bn-IN",
  );
});

test("Telugu → te-IN", () => {
  assert.equal(detectLangFromText("ఇది పరీక్ష కోసం ఉపయోగించే తెలుగు వాక్యం."), "te-IN");
});

test("Tamil → ta-IN", () => {
  assert.equal(
    detectLangFromText("இது சோதனைக்காக பயன்படுத்தப்படும் ஒரு தமிழ் வாக்கியம்."),
    "ta-IN",
  );
});

test("Kannada → kn-IN", () => {
  assert.equal(detectLangFromText("ಇದು ಪರೀಕ್ಷೆಗಾಗಿ ಬಳಸಲ್ಪಡುವ ಕನ್ನಡ ವಾಕ್ಯ."), "kn-IN");
});

test("Malayalam → ml-IN", () => {
  assert.equal(
    detectLangFromText("ഇത് പരീക്ഷണത്തിനായി ഉപയോഗിക്കുന്ന ഒരു മലയാളം വാക്യമാണ്."),
    "ml-IN",
  );
});

test("Gujarati → gu-IN", () => {
  assert.equal(detectLangFromText("આ પરીક્ષણ માટે ઉપયોગમાં લેવાતું ગુજરાતી વાક્ય છે."), "gu-IN");
});

test("Gurmukhi → pa-IN", () => {
  assert.equal(detectLangFromText("ਇਹ ਪਰੀਖਿਆ ਲਈ ਵਰਤਿਆ ਜਾਣ ਵਾਲਾ ਪੰਜਾਬੀ ਵਾਕ ਹੈ।"), "pa-IN");
});

test("Odia → or-IN", () => {
  assert.equal(detectLangFromText("ଏହା ପରୀକ୍ଷା ପାଇଁ ବ୍ୟବହୃତ ଓଡ଼ିଆ ବାକ୍ୟ।"), "or-IN");
});

test("Arabic script (Urdu) → ur-IN", () => {
  assert.equal(detectLangFromText("یہ ایک اردو جملہ ہے جو جانچ کے لیے استعمال ہوتا ہے۔"), "ur-IN");
});

test("Meitei Mayek → mni-IN", () => {
  // U+ABC0–U+ABFF range. Use a couple of consonants from the script.
  assert.equal(detectLangFromText("ꯀ ꯁ ꯂ ꯃ ꯄ"), "mni-IN");
});

test("Ol Chiki → sat-IN", () => {
  // U+1C50–U+1C7F range.
  assert.equal(detectLangFromText("ᱚᱛᱚᱵᱚᱛᱚ"), "sat-IN");
});

test("Cyrillic → ru-RU", () => {
  assert.equal(
    detectLangFromText("Это русское предложение, используемое для тестирования."),
    "ru-RU",
  );
});

test("Han → zh-CN", () => {
  assert.equal(detectLangFromText("这是一个用于测试的中文句子。"), "zh-CN");
});

test("Hiragana/Katakana → ja-JP", () => {
  assert.equal(detectLangFromText("これはテスト用の日本語の文です。テスト中。"), "ja-JP");
});

test("Hangul → ko-KR", () => {
  assert.equal(detectLangFromText("이것은 테스트를 위해 사용되는 한국어 문장입니다."), "ko-KR");
});

test("mixed-script doc: dominant script wins", () => {
  // Mostly Hindi with one stray English word — Devanagari should win.
  const mixed =
    "यह एक हिंदी वाक्य है जिसका उपयोग परीक्षण के लिए किया जाता है। " +
    "यह एक और हिंदी वाक्य है। यह भी हिंदी है। " +
    "Hello world.";
  assert.equal(detectLangFromText(mixed), "hi-IN");
});

test("whitespace-only / punctuation-only → en-US", () => {
  assert.equal(detectLangFromText("\n\n   !!!  ???  ..."), "en-US");
  assert.equal(detectLangFromText("12345 67890"), "en-US");
});

test("detectLangFromDocs: empty array → en-US", () => {
  assert.equal(detectLangFromDocs([]), "en-US");
  assert.equal(detectLangFromDocs(null), "en-US");
  assert.equal(detectLangFromDocs(undefined), "en-US");
});

test("detectLangFromDocs: reads first doc only", () => {
  // First doc is Hindi; second is Bengali — Hindi should win (we only
  // sample the first doc to keep detection cheap).
  const docs = [
    { chunks: ["यह एक हिंदी वाक्य है। यह परीक्षण के लिए है।"] },
    { chunks: ["এটি একটি বাংলা বাক্য।"] },
  ];
  assert.equal(detectLangFromDocs(docs), "hi-IN");
});

test("detectLangFromDocs: joins multiple chunks before scanning", () => {
  const docs = [
    {
      chunks: [
        "Chunk one is short.",
        "এটি দ্বিতীয় অংশ যেখানে বাংলা পাঠ্য রয়েছে।",
        "And a third chunk.",
      ],
    },
  ];
  assert.equal(detectLangFromDocs(docs), "bn-IN");
});

test("short sample still detects dominant script", () => {
  assert.equal(detectLangFromText("नमस्ते"), "hi-IN");
  assert.equal(detectLangFromText("வணக்கம்"), "ta-IN");
  assert.equal(detectLangFromText("ᱥᱟᱱᱛᱟᱲᱤ"), "sat-IN");
});
