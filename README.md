# Telux — Document Intelligence

Telux is a privacy-first document assistant. Drop in a PDF, contract, lab
report or rental agreement and ask questions in plain language. Files stay
in your browser's local storage; only a handful of pre-scored paragraphs
plus your question leave the device to generate an answer.

This README is a working guide for the codebase. If you are setting Telux
up for the first time, jump to **Test mode setup** below.

---

## Test mode setup

Test mode means "running locally with real keys so you can poke at every
feature without spending money". Three keys are needed.

### 1. Groq API key (required — for chat and Talk with Document answers)

Groq is a fast, free-tier inference provider that powers every answer.

1. Open **<https://console.groq.com>** and sign up (GitHub SSO is one click).
2. In the left sidebar, click **API Keys**.
3. Click **Create API Key**, give it any name, copy the value.
   - It will only be shown once. Paste it straight into `.env` (see below).
4. The free tier includes enough tokens for hundreds of questions per day.

`GROQ_API_KEY` is read by the serverFn in `src/lib/chat.ts` and **never**
reaches the browser bundle. The chat panel and Talk with Document will
both fail with a clear "GROQ_API_KEY is not configured" error if the key
is missing.

### 2. Supabase (required for sign-up / log-in / onboarding / trial)

1. Create a free project at **<https://supabase.com>**.
2. Open **Project Settings → API** and copy:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)
3. (Optional) Enable Google sign-in under **Authentication → Providers →
   Google**. Add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   to your Google OAuth client's "Authorized redirect URIs".
4. Register your app's redirect URL in **Authentication → URL
   Configuration → Redirect URLs**:
   - `http://localhost:3000/auth/callback` (dev)
   - `https://YOUR_VERCEL_DOMAIN.vercel.app/auth/callback` (preview)
   - `https://YOUR_PRODUCTION_DOMAIN/auth/callback` (prod)

### 3. Database migrations (run once in Supabase SQL Editor)

Migrations live in `supabase/sql/`. Run them in order, top-down:

1. `0001_auth_and_rls.sql` — profiles, auth events, storage lockdown.
2. `0002_subscriptions_and_onboarding.sql` — `subscriptions` table, 3-day
   trial, `onboarding_responses`, handles the `onboarding_completed` flag.
3. `0003_paid_billing_cycle.sql` — adds `billing_cycle` / `valid_until` so
   the Razorpay webhook can flip a row to monthly or yearly and the resolver
   recognises the paid window.
4. `0004_onboarding_responses.sql` — `onboarding_responses` table (name /
   age / "how did you hear") that the OnboardingModal writes to. The
   trial is gated on a row existing here.

Each file has a "Verify with" comment at the bottom so you can run a SELECT
to confirm the schema is correct.

### 4. Razorpay (only needed to test paid plans)

See [Deployment → Razorpay](#razorpay) below.

### 5. ElevenLabs (optional — for higher-quality TTS in /talk and chat)

Talk with Document and the chat read-aloud button default to the OS
SpeechSynthesis voices. For natural-sounding voices in Hindi, Telugu,
Tamil, Bengali, etc., wire up an ElevenLabs account.

1. Sign up at **<https://elevenlabs.io>**. The free tier ships with
   ~10k characters/month — plenty for trying Telux out.
2. Profile → **API Key** → copy.
3. Paste it into `.env`:
   ```env
   ELEVENLABS_API_KEY=your_elevenlabs_key
   ```
4. (Optional) Override the default voice:
   ```env
   ELEVENLABS_DEFAULT_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   ```
   The default is "Rachel" (English). Browse the voice library at
   <https://elevenlabs.io/app/voice-library> and replace with any voice id.

When the key is present, the TTS provider picker in the `/talk` header and
the chat panel reveals an **ElevenLabs** option next to **Browser**. The
serverFn in `src/serverFns/tts.ts` rate-limits per user (60 calls/hour)
and falls back to browser TTS on rate-limit / upstream errors so a quota
exhaustion never breaks the voice loop.

### 6. Putting it all together

Copy `.env.example` to `.env` and fill the values in. See
[`.env.example`](.env.example) for the complete reference; the absolute
minimum for a chat-only local dev is:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GROQ_API_KEY=gsk_xxx_your_real_key_xxx
```

Then start the dev server:

```sh
npm install
npm run dev
```

Sign up, upload a document, and ask a question. If you see answers
streaming in, test mode is working. To test high-quality TTS in /talk,
add `ELEVENLABS_API_KEY` (see section 5 above).

---

## What lives where

- **Documents**: stored in IndexedDB (`telux` database, `documents`
  object store). Cleared from your device, cleared forever.
- **Plan + monthly counter**: `localStorage` under `telux:usage:v1`.
- **Question/answer traffic**: HTTPS to Groq. We do not log requests;
  Groq's own privacy policy applies once the bytes leave the server.

## Scripts

```sh
npm run dev      # Vite dev server (HMR)
npm run build    # Production build (Nitro server bundle in .output/)
npm run preview  # Serve the production build locally
npm run lint     # ESLint
npm run format   # Prettier
```

## Security notes

- `.env` is in `.gitignore` — never commit it.
- All server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ELEVENLABS_API_KEY`)
  are read via `process.env` on the server side. They never appear in the
  browser bundle.
- `VITE_*` env vars are inlined by Vite at build time. Only put values
  in those that are safe to ship to every visitor.
- CSRF protection is on for every serverFn call (`createCsrfMiddleware`
  in `src/start.ts`). The Razorpay webhook is authenticated via HMAC
  signature, not CSRF.
- The `onboarding_responses` table is gated by RLS — users can read and
  write only their own row. The `service_role` grant is a backfill
  escape hatch for migrations, not for runtime reads.

> ⚠️ **If any secret was ever committed to git history, rotate it
> immediately.** Removing a literal from source code does NOT invalidate
> the old value — anyone with read access to the repository (including
> forks, mirrors, and cached clones) still has it. After every rotation:
>
> 1. Generate a fresh key in the upstream dashboard (Supabase → API,
>    Groq → API Keys, Razorpay → API Keys, ElevenLabs → Profile).
> 2. Update `.env` (and Vercel env vars) with the new value.
> 3. Restart the dev server / redeploy so cached env vars reload.
> 4. Revoke the old key in the upstream dashboard to confirm no other
>    client is still using it.
> 5. If the project is public, scrub the old value from git history
>    (`git filter-repo` or BFG) — but treat it as already-compromised
>    regardless. Rotation is the only reliable fix.

---

## Deployment — Vercel

Telux is a TanStack Start SSR app — Nitro bundles it into a single Node
entry point at `.output/server/index.mjs`, and Vercel's TanStack Start
preset auto-detects the project on push. **No `vercel.json` build
configuration is required**; the included `vercel.json` only adds
security headers.

### 1. Push to GitHub

```sh
git init
git add .
git commit -m "initial"
gh repo create telux --public --source=. --push
```

### 2. Import the repo in Vercel

1. Open **vercel.com → Add New → Project → Import** the repo.
2. Vercel auto-detects the build:
   - **Build Command**: `npm run build`
   - **Output Directory**: `.output` (Nitro's standard location)
   - **Install Command**: `npm install`
3. Click **Deploy** — the first build will fail because env vars are
   missing, which is fine. Continue to step 3.

### 3. Configure environment variables

In **Project Settings → Environment Variables**, set the following. Mark
the server-only ones as available to **Production** (and **Preview** if
you want preview deployments to work):

| Variable                      | Where it goes    | Notes                                                         |
| ----------------------------- | ---------------- | ------------------------------------------------------------- |
| `VITE_SUPABASE_URL`           | Build + runtime  | Required for the browser SDK                                  |
| `VITE_SUPABASE_ANON_KEY`      | Build + runtime  | Required for the browser SDK                                  |
| `SUPABASE_SERVICE_ROLE_KEY`   | **Runtime only** | **Never** prefix with `VITE_`                                 |
| `GROQ_API_KEY`                | **Runtime only** | Server-side chat proxy                                        |
| `RAZORPAY_KEY_ID`             | Runtime          | Public half of Razorpay key                                   |
| `RAZORPAY_KEY_SECRET`         | **Runtime only** | Never prefix with `VITE_`                                     |
| `RAZORPAY_WEBHOOK_SECRET`     | **Runtime only** | Used by webhook HMAC                                          |
| `RAZORPAY_PLAN_*`             | Runtime          | Paise amounts, see `.env.example`                             |
| `ELEVENLABS_API_KEY`          | **Runtime only** | Optional. Unset = OS SpeechSynthesis fallback                 |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Runtime          | Optional. Defaults to "Rachel"                                |
| `VITE_AUTH_REDIRECT_ORIGIN`   | Build            | **Leave unset** unless you put the app behind a reverse proxy |

> **Do not prefix server secrets with `VITE_`.** Anything `VITE_` is
> inlined into the browser bundle and shipped to every visitor. The
> service-role key bypasses row-level security; the Razorpay secret can
> forge payments; the webhook secret can forge webhook events.

### 4. (Recommended) Supabase Redirect URLs

In **Supabase Dashboard → Authentication → URL Configuration → Redirect
URLs**, register:

- `https://your-domain.vercel.app/auth/callback`
- `https://*.vercel.app/auth/callback` (catches every preview deployment)

### Razorpay

1. Sign up at **<https://dashboard.razorpay.com>**. Toggle **Test Mode**
   (top-left of the dashboard) for development — test keys are prefixed
   `rzp_test_` and live keys `rzp_live_`. The same code path handles both.
2. **Settings → API Keys → Generate Test Key** — gives `RAZORPAY_KEY_ID`
   and `RAZORPAY_KEY_SECRET`. Both are required.
3. **Settings → Webhooks → Create New Webhook**:
   - **URL**: `https://your-domain.vercel.app/api/razorpay/webhook`
   - **Events** (all are required):
     - `subscription.activated` — first successful payment
     - `subscription.charged` — every recurring charge
     - `subscription.completed` — subscription finished its full term
     - `subscription.cancelled` — user cancelled (we keep `valid_until` so
       they retain access until the period ends)
     - `payment.captured` — fallback for one-off payments
   - **Active** toggle: ON
   - Copy the secret → `RAZORPAY_WEBHOOK_SECRET`
4. The `RAZORPAY_PLAN_*` env vars control pricing in paise without code
   changes (overwrite the defaults in `.env.example`).

**Test mode permissions** (Test Mode dashboard):

- Only Razorpay's published test cards / UPI IDs / wallets work. Live
  cards are rejected.
- Use card `4111 1111 1111 1111`, any future expiry, any CVV — the most
  common test card.
- Webhooks fire normally to the configured URL during testing.
- No real money moves — every test payment is a fake charge.
- Subscription events still fire on the configured schedule, so you can
  verify the full webhook handler end-to-end.

**Webhook behaviour:**

- Our handler returns `200` within a few milliseconds (the Supabase write
  is the only blocking step). If you see `400` in Razorpay's webhook log
  it means the HMAC signature didn't match — check `RAZORPAY_WEBHOOK_SECRET`
  and that the URL is exactly the one configured in the dashboard.
- Razorpay retries `4xx`/`5xx` up to 8 times over 24 hours. Our handler
  is idempotent, so a duplicate `subscription.activated` is safe.
- Our handler `console.info`s `event=<name> user=<id>` on every success
  — search the deploy logs for `razorpay-webhook` to see exactly which
  events are firing.

### 5. Security hardening (already configured in `vercel.json`)

The committed `vercel.json` adds these response headers automatically:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(self), geolocation=()`

CSRF is enforced for every serverFn (`createCsrfMiddleware` in
`src/start.ts`); do not disable it. The Razorpay webhook authenticates
requests with HMAC-SHA256 against `RAZORPAY_WEBHOOK_SECRET`; mismatched
signatures return 400.

### 6. Post-deploy smoke test

1. Sign up with a new email → the OnboardingModal asks three questions
   (name, age, how did you hear about us) before the trial starts.
2. Open **/billing** → click **Start 3-day trial** → the OnboardingModal
   appears if it's your first sign-in (three questions: name, age, how
   you heard about us). After submitting, the banner at the top of
   `/dashboard` shows "Trial active · 3 days left of Pro".
3. Open `/talk` → the voice workspace is unlocked. Speak a phrase; the
   mic waveform appears and the answer streams.
4. Switch the language picker in the `/talk` header to Hindi (or any
   other supported language) → the orb's "Detected" badge updates and
   the answer comes back in the chosen language. Pick again from any
   other surface (chat panel read-aloud): the choice persists across
   routes.
5. With `ELEVENLABS_API_KEY` set, the `/talk` TTS provider picker shows
   **ElevenLabs** in addition to **Browser**. Pick ElevenLabs, speak,
   and verify the answer plays back in the chosen ElevenLabs voice.
   Inspect the deploy logs for `[elevenlabs] 200` lines to confirm the
   serverFn is hitting upstream.
6. Sign out, sign in from the same browser → the trial banner is still
   there (server-tracked, not localStorage).
7. In the Supabase Dashboard, check `select * from public.subscriptions;`
   — the row has `trial_started_at` and `trial_ends_at` populated.
8. Switch to yearly on the Billing page → the Personal card shows
   `₹2,870 / year` with the `Save 20%` badge.

---

## License

This codebase is yours to extend. Push to your own GitHub, deploy to
your own infrastructure, sell to your own users.
