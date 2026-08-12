// Server-side chat proxy. Holds the Groq API key, picks the most relevant
// chunks from those supplied by the client, and forwards a single completion
// request. The key is read from process.env (not import.meta.env) so it never
// enters the browser bundle.
//
// Privacy contract:
//   * The client never sends the entire document — only the candidate chunks
//     it pre-selected. We re-rank here for safety, but the contract is "few
//     thousand characters of pre-selected text + the user's question".
//   * We don't log request bodies server-side. We don't persist anything.
//   * The system prompt forbids the model from using anything outside of the
//     provided chunks and from leaking internal scaffolding (no "chunk N",
//     "according to", etc.).
//
// Voice gating:
//   * For `mode === "voice"` we require a signed-in user (`userId`) and
//     resolve their effective plan from `public.subscriptions` via
//     `getEffectivePlan`. Starter users are rejected with a friendly error.
//   * The old shared `VOICE_API_TOKEN` mechanism is gone — it was a soft
//     paywall trivially bypassed by reading the JS bundle. The DB row is
//     the only source of truth.
//
// Resilient behaviour:
//   * If chunks is missing or empty, we short-circuit with a friendly
//     "upload first" reply instead of bouncing a Zod validation error to the
//     chat. (Previously a fast user with no doc uploaded would see a raw
//     server error in the chat.)
//   * If the Groq request fails, we surface the upstream status text so the
//     UI can show a useful message.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { detectLangFromText } from "@/lib/detect-lang";
import { consume } from "@/lib/rate-limit";
import { getEffectivePlan } from "@/serverFns/subscription";
import { isSupabaseConfigured, userIdExists } from "@/lib/supabaseServer";
import { pickTopChunks } from "@/lib/chunk-picker";

// Friendly error thrown when the per-user chat rate limit is exceeded. The
// chat UI surfaces this as a one-line "slow down" toast instead of a generic
// server error so the user understands the cause.
export class ChatRateLimitedError extends Error {
  readonly code = "CHAT_RATE_LIMITED";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("You're sending messages too quickly. Please wait a moment and try again.");
    this.name = "ChatRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

const inputSchema = z.object({
  userId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  // A handful of pre-scored chunks the client picked. Optional — the server
  // falls back to a friendly "upload first" reply when the client sends
  // nothing (a no-document greeting would otherwise be rejected with a 400).
  chunks: z.array(z.string().min(1).max(4000)).max(8).optional(),
  // Recent chat history, only used to keep multi-turn context.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
  // "text" = regular chat (Starter allowed).
  // "voice" = Talk-with-Document / read-aloud / mic (Personal/Pro only).
  // The server resolves the user's effective plan from `subscriptions` when
  // mode === "voice" and rejects Starter users with a friendly error.
  mode: z.enum(["text", "voice"]).default("text"),
  // Optional BCP-47 language hint from the client. When present, the model
  // replies in this language regardless of the document content. When absent,
  // the server detects the language from the document chunks and falls back
  // to English. The unsupported-query fallback ("I can only answer questions
  // about the document…") is also produced in this language.
  forceLang: z.string().min(2).max(20).optional(),
  // Legacy field — accepted for backward-compat but no longer checked on the
  // server. Voice is gated by the user's `subscriptions` row instead.
  voiceToken: z.string().optional(),
});

export type ChatResponse = {
  answer: string;
  // Echo back which chunks were used so the client can show "cited from…" if
  // we want to add that later. Not used today.
  usedChunks: number;
};

export const askChat = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<ChatResponse> => {
    // ROI guard: confirm the userId in the payload is a real account before
    // we burn a rate-limit token or call Groq. A signed-in user could send
    // someone else's UUID otherwise and deplete their quota / bill them.
    // userIdExists() fail-opens when Supabase isn't configured so dev keeps
    // working without a backend.
    const realUser = await userIdExists(data.userId);
    if (!realUser) {
      throw new Error("Account not found. Please sign in again.");
    }

    // Rate limit per user, per minute. Prevents a script in the browser from
    // burning through the Groq free tier or running up the bill for paid
    // users. 20 messages per minute = roughly one question every 3 seconds,
    // which lets real users chat normally and stops a tight loop.
    const rl = consume(`chat:${data.userId}`, { capacity: 20, windowMs: 60_000 });
    if (!rl.ok) {
      throw new ChatRateLimitedError(rl.retryAfterMs);
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === "YOUR_GROQ_KEY") {
      throw new Error("GROQ_API_KEY is not configured. Add it to .env (server-side only).");
    }

    const chunks = data.chunks ?? [];

    // Voice / premium paywall. The server resolves the user's effective plan
    // from `public.subscriptions` so a Starter user cannot unlock voice by
    // editing localStorage. This replaces the old shared-secret check.
    if (data.mode === "voice") {
      const sub = await getEffectivePlan({ data: { userId: data.userId } });
      if (sub.effectivePlan === "starter") {
        throw new Error(
          "Voice features require a Personal or Pro plan. Upgrade in Billing to use Talk with Document.",
        );
      }
    }

    // No document context. Reply directly without calling the model — saves a
    // round-trip and avoids the model inventing answers when there's no source.
    if (chunks.length === 0) {
      // Default to English unless the caller pinned a language. The "upload
      // first" hint is intentionally always in English so it reads naturally
      // for new signups; the model's answer-language rule kicks in only when
      // there are document chunks to reason about.
      const noDocFallbacks: Record<string, string> = {
        "en-US":
          "I can only answer questions about a document you've uploaded. Add one on the left and ask again.",
        "hi-IN":
          "मैं केवल आपके द्वारा अपलोड किए गए दस्तावेज़ के बारे में सवालों का जवाब दे सकता हूँ। कृपया बाईं ओर एक दस्तावेज़ जोड़ें और फिर से पूछें।",
      };
      const fallback =
        data.mode === "voice"
          ? "Please upload a document first, then ask again."
          : (noDocFallbacks[data.forceLang ?? ""] ?? noDocFallbacks["en-US"]!);
      return { answer: fallback, usedChunks: 0 };
    }

    const isVoice = data.mode === "voice";
    const topChunks = pickTopChunks(data.question, chunks, 3);
    const context = topChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");

    // Reply language precedence:
    //   1. `forceLang` from the client (user picker or doc-language detection
    //      done client-side in ChatPanel) — explicit override wins.
    //   2. Server-side detection from the joined chunks (covers the case
    //      where the client didn't pass a lang).
    //   3. English.
    const replyLang = data.forceLang ?? detectLangFromText(context) ?? "en-US";

    const langRule =
      `Reply language: ${replyLang}.\n` +
      "  - Reply strictly in this language for the entire answer, including\n" +
      "    quotes from the document when possible.\n" +
      "  - If the user's question is written in a different language, still\n" +
      "    reply in the chosen language above (the document's language takes\n" +
      "    priority over the question's language).\n" +
      '  - The unsupported-query fallback ("I can only answer questions about\n' +
      '    the document…") must also be in this language.\n';

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content:
          (isVoice
            ? "You are Talk with Document, a careful document assistant inside the Telux app. "
            : "You are Talk with Document, a careful document assistant inside the Telux app. ") +
          "You answer ONLY using the snippets inside <document>...</document>. " +
          'If the answer is not in the document, reply exactly: "I can\'t find that in the document. Try rephrasing or uploading the relevant section." ' +
          'If the user\'s question is unrelated to the document (a greeting, weather, general knowledge, math, coding), reply exactly: "I can only answer questions about the document you uploaded. What would you like to know?"\n\n' +
          langRule +
          "Style:\n" +
          "  - Reply in plain prose. No markdown, no bullet lists, no code blocks, no headings, no bold or italic.\n" +
          '  - Never reference "chunks", "sections", "snippets", "according to", "based on the document", or any internal scaffolding. The user must never know how the answer is produced.\n' +
          '  - Never start with "Sure!", "Here\'s", "Certainly", "Of course", "Absolutely", or other filler phrases. Start directly with the answer.\n' +
          "  - Never include URLs, citations in brackets like [1], or footnotes.\n" +
          (isVoice
            ? "  - Spoken reply: 1-2 short sentences, under 40 words. Spoken style for the language, not formal written style. No lists, no numbers expressed as digits.\n"
            : "  - Written reply: keep it concise (under 80 words) unless the user asks for detail. Use complete sentences, not fragments.\n"),
      },
      ...(data.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: `<document>\n${context}\n</document>\n\nQuestion: ${data.question}`,
      },
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages,
        temperature: 0.1,
        // Voice replies stay short; written chat gets more room. Bumped from
        // 220/600 → 320/800 so answers don't truncate mid-sentence.
        max_tokens: isVoice ? 320 : 800,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Groq request failed (${response.status}). ${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawAnswer = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const answer =
      rawAnswer.length > 0
        ? cleanAnswer(rawAnswer)
        : "I couldn't generate an answer. Please try again.";

    return { answer, usedChunks: topChunks.length };
  });

/**
 * Post-process the model's reply so the user always sees clean prose.
 *
 * The model is told in the system prompt never to use bullets, headings,
 * markdown, citations like [1], or phrases like "according to the document"
 * — but models sometimes slip. Strip the worst offenders here so the chat
 * and voice replies stay consistent.
 *
 * What gets cleaned:
 *   - Citations like [1], [2], (1), (2) — removed.
 *   - Code-fence markers (` ``` `).
 *   - Markdown bold/italic (**...**, *...*, __...__) — unwrapped.
 *   - Leading filler ("Sure!", "Here's", "Certainly", "Of course",
 *     "Absolutely") at the very start of the reply.
 *   - "according to the document" / "based on the document" / "as mentioned
 *     in the document" / "chunks" mentions — replaced with nothing.
 *   - Leftover bullet markers ("- ", "* " at line start) — stripped.
 *   - Consecutive blank lines collapsed to one.
 */
function cleanAnswer(raw: string): string {
  let s = raw;
  // Markdown code fences
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?|```/gi, "").trim());
  s = s.replace(/`+/g, "");
  // Bold/italic markers — keep the inner text
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  // Citations [1], [12], etc.
  s = s.replace(/\[\d+\]/g, "");
  // "according to the document" / "based on the document" / mentions of
  // "chunks" / "excerpts" / "snippets" / "the provided text"
  s = s.replace(
    /\b(according to (the|your)?\s*(document|text|passage|file|excerpt|snippet|chunk|section)s?)\b/gi,
    "",
  );
  s = s.replace(
    /\b(based on (the|your)?\s*(document|text|passage|file|excerpt|snippet|chunk|section)s?)\b/gi,
    "",
  );
  s = s.replace(
    /\b(in (the|your)?\s*(document|text|passage|file|excerpt|snippet|chunk|section)s?)\b/gi,
    "",
  );
  s = s.replace(/\bas mentioned (in|above)\b/gi, "");
  // Leading filler at the very start of the answer
  s = s.replace(
    /^\s*(Sure[!.,]?\s*|Here('?|’s)\s+|^Certainly[!,.]?\s*|^Of course[!,.]?\s*|^Absolutely[!,.]?\s*)\s*/i,
    "",
  );
  // Bullet markers at line start
  s = s.replace(/^\s*[-*•]\s+/gm, "");
  // Headings (# ... / ## ...)
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Collapse multiple blank lines
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}
