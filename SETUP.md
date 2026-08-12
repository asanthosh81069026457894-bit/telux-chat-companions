# Telux — 5-Minute Setup (free, no card required)

All three services below have a free tier with **no credit card required**. Once you paste
your real keys into `.env`, restart the dev server, and signup → trial → Talk with Document
will work end-to-end.

> **TL;DR — what's actually wrong right now**
> Your `.env` still has the placeholder markers (`__REPLACE_WITH_YOUR_*__`) I left for you.
> Every server-side function (trial start, billing, Razorpay checkout, chat) reads
> Supabase / Groq / Razorpay with those keys and fails with a generic "API error" message.
> Fix the four values below and the app comes alive.

---

## 1. Supabase — free tier (DB + auth)

1. Go to https://supabase.com → **Start your project** → sign in with GitHub.
2. Click **New Project**, give it any name (e.g. `telux-dev`), pick a region near you,
   set a DB password (save it somewhere — you won't need it again), click **Create**.
   Free tier is fine.
3. While the project spins up (~90 s), open **SQL Editor** (left sidebar). In order, run the
   three migration files in `supabase/sql/`:
   - `0001_auth_and_rls.sql`
   - `0002_subscriptions_and_onboarding.sql`
   - `0003_paid_billing_cycle.sql`

   Open each file, copy its contents into a new SQL query, click **Run**. They are
   idempotent — re-running is safe.

4. **Get the public values** (for `.env`):
   - Left sidebar → **Project Settings** (gear icon) → **API**.
   - Copy **Project URL** → paste as `VITE_SUPABASE_URL`.
   - Copy the `anon` / `public` row → paste as `VITE_SUPABASE_ANON_KEY`.
5. **Get the service-role key** (for `.env`, server-only):
   - Same **API** page, but click **service_role** (the secret one — never ship this to
     the browser). Paste as `SUPABASE_SERVICE_ROLE_KEY`.
6. **Disable email confirmation** (so signup is one-click, no inbox round-trip):
   - Left sidebar → **Authentication** → **Providers** → **Email** → toggle **OFF**
     "Confirm email" → Save.
   - (You can re-enable it later for production. For dev, off = instant sign-in.)

---

## 2. Groq — free tier (chat + voice)

1. Go to https://console.groq.com → sign in with Google or GitHub.
2. Left sidebar → **API Keys** → **Create API Key** → name it `telux` → copy the value
   (starts with `gsk_`). Paste as `GROQ_API_KEY`.
3. Free tier is generous for personal use:
   - **~30 requests/minute**
   - **~14,400 requests/day**
   - **No card required**, never expires.

> **Why Groq and not OpenAI?** Groq's free tier is large enough to ship a real product on.
> OpenAI's free credits expire and the per-request cost is ~10× higher. Llama-3.1-8b-instant
> on Groq answers document-Q&A at the same quality as GPT-4o-mini for our use case.
>
> **Alternatives if you want them**
>
> - **OpenRouter** (https://openrouter.ai) — free credits on signup, gives you access to
>   Llama/Mistral/Claude/GPT through one key. Drop-in replacement for Groq.
> - **Google AI Studio** (https://aistudio.google.com) — Gemini 1.5 Flash free tier, 15 RPM.
> - **Mistral** (https://console.mistral.ai) — free tier, La Plateforme.

---

## 3. Razorpay — test mode (free, no real money)

1. Go to https://dashboard.razorpay.com → **Sign Up** (Google sign-in works).
2. Top-left toggle: **Test Mode** ON (orange badge).
3. **API Keys**: Settings (gear) → **API Keys** → **Generate Test Key** → copy both:
   - **Key ID** (starts with `rzp_test_`) → paste as `RAZORPAY_KEY_ID`.
   - **Key Secret** → paste as `RAZORPAY_KEY_SECRET`.
4. **Webhook secret** (so subscription events flip your DB row):
   - Settings → **Webhooks** → **Create New Webhook**:
     - **Webhook URL**: `https://your-domain.com/api/razorpay/webhook` (for local dev, use
       https://your-ngrok-url.ngrok-free.app/api/razorpay/webhook — see step 4 below).
     - **Active Events**: tick `subscription.activated`, `subscription.charged`,
       `subscription.completed`, `subscription.cancelled`, `payment.captured`.
     - Click **Create** → copy the **Webhook Secret** → paste as `RAZORPAY_WEBHOOK_SECRET`.
5. **Test card**: use `4111 1111 1111 1111` / any future expiry / any CVV.
6. **For local dev**, you need a public URL so Razorpay can hit your webhook. Two options:
   - **Razorpay CLI** (recommended): `npm i -g razorpay-cli`, then `rzp webhooks forward
http://localhost:3000/api/razorpay/webhook --event subscription.activated`. It prints
     a forwarding URL you paste into the webhook setup above.
   - **ngrok**: `ngrok http 3000`, paste the `https://…ngrok-free.app` URL.

> **Why Test Mode is fine for now** — Test mode never charges real money and never needs
> KYC. You can demo the full subscribe flow (checkout → webhook → plan activation → voice
> unlock) without a bank account. Switch to Live Mode (same form, real keys) when you're
> ready to accept real payments.

---

## 4. Final `.env` for local dev

After the three steps above, your `.env` should look like this (replace the placeholders only):

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...long-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJ...long-service-role-key
GROQ_API_KEY=gsk_...your-groq-key
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

Restart your dev server (`npm run dev`) — the env validator will warn in the console if any
key is still a placeholder.

---

## 5. What happens after signup (the exact flow)

1. You fill the signup form → Supabase creates a user via the public anon key.
2. The dashboard mounts → `AuthGate` calls `startTrial({ userId })` server function →
   it writes `trial_started_at` + `trial_ends_at` to `public.subscriptions` using the
   **service-role key** (this is what was failing before).
3. You're in. The 7-day trial unlocks Talk with Document + voice + unlimited pages.
4. Click **Subscribe** on any plan → Razorpay checkout in a new tab → webhook flips your
   subscription row to `personal` or `pro`.

---

## 6. What was already fixed in this session

- `routeTree.gen.ts` — added the missing `/dashboard/documents` route so TypeScript
  compiles cleanly.
- `.env` — replaced placeholder values with explicit `__REPLACE_WITH_*__` markers and
  inline setup instructions.
- `src/lib/env.ts` — added a placeholder detector so the dev console surfaces
  `[env] missing keys — public: []; server: [SUPABASE_SERVICE_ROLE_KEY]` instead of a
  silent 500 from the server.

---

## 7. Free API-key cheat-sheet (quick links)

| Service                | Free tier                        | URL                            | Card needed |
| ---------------------- | -------------------------------- | ------------------------------ | ----------- |
| Supabase               | 500 MB DB, 1 GB storage, 50k MAU | https://supabase.com           | No          |
| Groq (Llama 3.1 8B)    | 30 RPM, 14.4k RPD                | https://console.groq.com       | No          |
| Razorpay Test          | Unlimited test txns              | https://dashboard.razorpay.com | No          |
| Google AI Studio (alt) | 15 RPM Gemini Flash              | https://aistudio.google.com    | No          |
| OpenRouter (alt)       | Free credits on signup           | https://openrouter.ai          | No          |
| Mistral (alt)          | 5 RPM La Plateforme              | https://console.mistral.ai     | No          |
