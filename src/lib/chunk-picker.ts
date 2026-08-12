// Pure chunk-ranking helper used by src/lib/chat.ts. Extracted into its own
// file so it can be unit-tested without spinning up the chat serverFn.
//
// Scoring: for each chunk, count overlap with the question's tokens (after
// stopword removal), then divide by sqrt(chunk-tokens). The sqrt normalises
// the score against chunk length so a long paragraph doesn't drown out a
// short, on-point sentence by sheer frequency.

const STOPWORDS = new Set([
  "a",
  "an",
  "am",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "about",
  "any",
  "all",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "do",
  "does",
  "did",
  "been",
  "being",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Rank `chunks` by relevance to `question` and return the top `topK`.
 * When the question has no useful tokens (pure stopwords), the first
 * `topK` chunks are returned in their input order — this matches the
 * previous behaviour and avoids returning an empty array.
 */
export function pickTopChunks(question: string, chunks: string[], topK = 3): string[] {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return chunks.slice(0, topK);
  const scored = chunks.map((text) => {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { text, score: 0 };
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let overlap = 0;
    for (const q of qTokens) overlap += tf.get(q) ?? 0;
    return { text, score: overlap / Math.sqrt(tokens.length) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.text);
}

/** Exposed for tests only. Production code uses pickTopChunks. */
export const __test__ = { tokenize };
