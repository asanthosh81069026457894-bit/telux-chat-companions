// Lightweight, dependency-free relevance scoring for picking the chunks that
// most likely contain the answer to a question. Pure function — same inputs
// always produce the same outputs. No embeddings; just token overlap with a
// stopword filter and a small length-normalization tweak so a 4k-char chunk
// doesn't beat a 1k-char chunk just because it has more words.

const STOPWORDS = new Set([
  "a",
  "an",
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

export type ScoredChunk = { index: number; score: number; text: string };

export function scoreChunks(question: string, chunks: string[], topK = 3): ScoredChunk[] {
  if (chunks.length === 0) return [];
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) {
    // No usable signal from the question — return the first chunks in order.
    return chunks.slice(0, topK).map((text, i) => ({ index: i, score: 0, text }));
  }

  const scored: ScoredChunk[] = chunks.map((text, index) => {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { index, score: 0, text };
    // Term-frequency map for the chunk.
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    // Sum of term frequencies for terms that also appear in the question.
    let overlap = 0;
    for (const q of qTokens) overlap += tf.get(q) ?? 0;
    // Normalize by sqrt(chunk length) so longer chunks don't dominate.
    const score = overlap / Math.sqrt(tokens.length);
    return { index, score, text };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
