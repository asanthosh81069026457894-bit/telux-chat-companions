// Rate-limited authentication serverFns.
//
// Why this lives here instead of useAuth.tsx:
//   - The Supabase anon-key client runs in the BROWSER. There is no
//     way to rate-limit it from the server side because the request
//     always goes directly to Supabase. A script that knows your
//     VITE_SUPABASE_URL + anon key can hammer the auth endpoint at
//     line speed.
//   - Moving signup + login through a serverFn gives us a place to
//     apply a per-IP / per-email rate limit BEFORE the Supabase call
//     is made. The round-trip costs ~50ms but the protection is
//     worth it for B2C traffic.
//
// What it does NOT do:
//   - We do NOT duplicate Supabase's password hashing / session minting.
//     The serverFn still calls `supabase.auth.signUp` / `signInWithPassword`
//     — just on the server side. The resulting session is returned to
//     the browser, which then sets it into the anon client. (No service-
//     role leakage: we use the anon client, not the service-role client,
//     so RLS still gates the user.)
//   - We do NOT log the email or password at any point.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getAnonClient } from "@/lib/supabaseServer";
import { enforceRateLimit, TooManyRequestsError } from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  // Supabase's minimum password length is 6, but we recommend 8+ in the UI.
  // 200 chars covers any sane password while still rejecting 50KB payloads.
  password: z.string().min(6).max(200),
});

// Email is normalised to lowercase + trimmed before being used as the
// rate-limit key. The same email from "Bob@x.com" and "bob@x.com " would
// otherwise occupy two buckets.
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const signupWithRateLimit = createServerFn({ method: "POST" })
  .validator(credentialsSchema.extend({ fullName: z.string().max(120).optional() }))
  .handler(async ({ data, context }) => {
    // IP is captured by the request middleware in src/start.ts and stashed
    // on the serverFn context. Fall back to "unknown" so the rate-limit
    // bucket still functions if a future refactor removes the middleware.
    const ip = (context as { ip?: string }).ip ?? "unknown";
    const email = normaliseEmail(data.email);

    // Per-IP bucket: 5 signups per hour. A single home network shouldn't
    // ever burn through this, but a bot running through residential proxies
    // can't either.
    enforceRateLimit(
      `signup:ip:${ip}`,
      { capacity: 5, windowMs: 60 * 60 * 1000 },
      "signup attempts",
    );

    // Per-email bucket: 3 signups per email per 24h. This catches the case
    // where a bot rotates IPs but keeps trying the same address.
    enforceRateLimit(
      `signup:email:${email}`,
      { capacity: 3, windowMs: 24 * 60 * 60 * 1000 },
      "signup attempts for this email",
    );

    const supabase = getAnonClient();
    // Origin for the email-redirect link. The signup.tsx route already
    // sets `emailRedirectTo`, but we re-derive it here so the server is
    // self-contained — never trust the browser for this value. Headers
    // are captured by the request middleware in src/start.ts.
    const headers = (context as { headers?: Headers }).headers ?? new Headers();
    const origin = headers.get("origin") ?? headers.get("referer")?.replace(/\/$/, "") ?? "";
    const safeOrigin = origin.startsWith("http") ? origin.replace(/\/$/, "") : "";

    const { data: result, error } = await supabase.auth.signUp({
      email,
      password: data.password,
      options: {
        emailRedirectTo: safeOrigin ? `${safeOrigin}/auth/callback` : undefined,
        data: data.fullName?.trim() ? { full_name: data.fullName.trim() } : undefined,
      },
    });

    if (error) {
      // Don't echo Supabase's raw error string — it can include hints like
      // "User already registered" that we want to keep generic. Translate
      // the common ones here.
      const msg = error.message.toLowerCase();
      if (msg.includes("already registered") || msg.includes("already been registered")) {
        // Don't 200-spam: this is the legitimate case where a user
        // mistypes their password on a known email. Returning a generic
        // message keeps the per-email bucket still useful (a script will
        // hit the cap regardless of outcome).
        throw new Error("An account with this email already exists. Try signing in instead.");
      }
      if (msg.includes("rate limit") || msg.includes("too many")) {
        throw new TooManyRequestsError(60 * 60 * 1000, "signup attempts from this network");
      }
      // Catch-all: surface the raw message. Supabase's auth errors are
      // generally safe to display (no secrets in them).
      throw new Error(error.message);
    }

    return {
      userId: result.user?.id ?? null,
      needsEmailConfirmation:
        result.session == null && result.user != null && result.user.email_confirmed_at == null,
    };
  });

export const loginWithRateLimit = createServerFn({ method: "POST" })
  .validator(credentialsSchema)
  .handler(async ({ data, context }) => {
    // IP is captured by the request middleware in src/start.ts and stashed
    // on the serverFn context. Fall back to "unknown" so the rate-limit
    // bucket still functions if a future refactor removes the middleware.
    const ip = (context as { ip?: string }).ip ?? "unknown";
    const email = normaliseEmail(data.email);

    // Per-IP: 20 attempts per 10 minutes. Lets a user mistype their
    // password 3-4 times in a row without friction, but stops credential
    // stuffing.
    enforceRateLimit(
      `login:ip:${ip}`,
      { capacity: 20, windowMs: 10 * 60 * 1000 },
      "login attempts",
    );

    // Per-email: 10 attempts per 10 minutes. Even a focused attacker
    // who only targets one account will hit this quickly.
    enforceRateLimit(
      `login:email:${email}`,
      { capacity: 10, windowMs: 10 * 60 * 1000 },
      "login attempts for this account",
    );

    const supabase = getAnonClient();
    const { data: result, error } = await supabase.auth.signInWithPassword({
      email,
      password: data.password,
    });

    if (error) {
      // Map Supabase's "Invalid login credentials" to a generic message —
      // it's the same whether the email exists or not, which is correct
      // (don't leak account existence). Anything else passes through.
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login credentials")) {
        throw new Error("Email or password is wrong. Double-check both and try again.");
      }
      if (msg.includes("email not confirmed")) {
        throw new Error("Please confirm your email first — check your inbox for the link.");
      }
      throw new Error(error.message);
    }

    if (!result.session) {
      throw new Error("Login succeeded but no session was returned. Please try again.");
    }

    // Return the session shape the browser anon-client expects. The
    // browser applies it via `supabase.auth.setSession()` in useAuth.
    return {
      accessToken: result.session.access_token,
      refreshToken: result.session.refresh_token,
      expiresAt: result.session.expires_at,
      userId: result.user?.id ?? null,
    };
  });
