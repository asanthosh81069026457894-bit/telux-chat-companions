# Telux launch state

Last updated: 2026-08-09.

The user's "Telux Chat Companion" is a single-product, single-user launch.
Everything below is the contract the codebase ships with as of the date
above. Don't revert any of it without an explicit user ask.

## Surface inventory

| Surface                  | Route                                             | Storage                                             | Notes                                                         |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Brand / nav              | `dashboard-nav.tsx`                               | —                                                   | No pickers, no trial pill, no chatter.                        |
| Dashboard workspace      | `routes/dashboard.tsx`                            | —                                                   | Documents + chat panel + Praxix peek view, three-tab nav.     |
| Chat panel               | `components/ChatPanel.tsx`                        | `localStorage["telux:chat-history-v1"]` (max 200)   | Persistent across reloads.                                    |
| Talk with Document       | `routes/talk.tsx`                                 | Module-level (session-only)                         | Ephemeral by design — voice workspace, not a chat log.        |
| Praxix full workspace    | `routes/praxix.tsx`                               | `localStorage["telux:praxix-history-v1"]` (max 200) | Persistent across reloads; full-viewport Claude-style layout. |
| Praxix right-column peek | `components/PraxixPanel.tsx` (right-column mount) | Same Praxix store                                   | Shares history with `/praxix`.                                |

## State stores

Three external stores in `src/components/dashboard-state.tsx`:

- `useChatMessages()` — chat panel. Module-level + localStorage. Replaces the
  old in-context store that wiped on Provider unmount.
- `useTalkMessages()` — talk transcript. Module-level only (session-only).
- `usePraxixMessages()` — Praxix history. Module-level + localStorage.

`DashboardStateProvider` is now an empty marker provider kept for future
dashboard-only state; chat data lives in `useChatMessages()`.

## Trial → Pro contract

- Personal plan: 3-day trial, then forced upgrade to Pro.
- Trial state surfaced via `useUsage()` (`src/hooks/useUsage.ts`):
  - `trialUntil: Date | null`, `trialDaysRemaining: number | null`.
- TrialBanner below the header owns the cancel/upgrade CTAs.
- Header is clean: brand, tabs, email chip, sign-out — no pill.

## Language picker / Voice picker

- `useVoices()` (`src/hooks/useVoices.ts`) is the single source of truth.
- `localStorage["telux:voice-lang"]` and `["telux:voice-gender"]`.
- Mounted on chat surfaces that need it (chat panel, talk, Praxix);
  intentionally absent from `dashboard-nav.tsx` (was visual noise).
- Praxix reply language is server-detected from the user's most recent
  turn — `forceLang` was removed from `askPraxix` (`src/serverFns/praxix.ts`).

## Praxix hint-mode contract

- ServerFn: `askPraxix` in `src/serverFns/praxix.ts`.
- Model: `llama-3.1-8b-instant` via Groq.
- Reply language: detected from question text (Unicode-script heuristic in
  `src/lib/detect-lang.ts`), not the picker locale.
- i18n: `src/lib/praxix-i18n.ts` — 18 BCP-47 entries (en, hi, bn, ta, te, kn,
  ml, mr, gu, pa, or, as, ur, es, fr, de, pt, ar). Add a new language by
  appending to `PRAXIX_COPY` — `lookupPraxixCopy` falls back to en-US.
- System prompt is a learning-first teacher: reflect briefly, point at
  principle, address sub-questions in order, close with a natural follow-up
  question. No "Your turn" boilerplate. ≤110 words. No markdown.
- Copy table that intentionally still references "hints" not "answers":
  `placeholder`, `thinking`, `hintBanner`, `emptyState`, `regenerate`,
  `goodResponse`, `badResponse`, `clearLabel`, `clearConfirm`.

## Rate limits

- Chat (`askChat`): 20/minute per `callerId`.
- Praxix (`askPraxix`): 20/minute per `callerId` (anonymous-friendly).
- `callerId` is the Supabase user id when signed in, or a stable
  `localStorage`-generated uuid for the anonymous preview bucket.

## Why: core invariants the user pushed for

- **Header is clean.** The user found pickers + trial pill + duplicate
  rows noisy.
- **Praxix is full-screen + Claude-style.** /praxix is its own route,
  single focused column, `max-w-3xl`, no card border on assistant text.
- **Conversations build up over time.** User asked specifically for
  scroll-to-top + scroll-to-bottom on all chat surfaces plus
  cross-reload persistence (now wired on chat + Praxix via localStorage).
