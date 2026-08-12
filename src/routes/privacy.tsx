// Privacy Policy page.
//
// Plain, professional prose explaining what Telux does and does not collect.
// The Telux promise is "your documents never leave your device." This page
// walks through exactly what does leave: a handful of pre-scored chunks
// (the relevant paragraphs) plus the user's question, sent to Groq's
// free-tier Llama endpoint to generate an answer. Full text of the document
// never leaves the browser.
//
// Voice: STT and TTS use the browser's Web Speech API. Audio is captured and
// synthesized locally — no audio is ever uploaded or stored by Telux.
//
// Auth: Supabase Auth (email + password). Email is stored on Supabase.

import { createFileRoute } from "@tanstack/react-router";

import { Reveal } from "@/components/Reveal";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

const title = "Privacy Policy — Telux";
const description =
  "Your documents never leave your device. Telux only sends a handful of pre-scored paragraphs and your question to a language model. Audio stays in your browser. No analytics, no tracking.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="px-5 pt-32 pb-24 md:pt-36">
        <article className="prose-telux mx-auto max-w-3xl">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1.5">
              <span className="pulse-ring size-1.5 rounded-full bg-signal" />
              <span className="eyebrow">Privacy</span>
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-5xl">
              Your documents never leave your device.
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="mt-4 text-base text-muted-foreground md:text-lg">
              This is the short version. The full version is below — it&apos;s written in plain
              English, not fine print, because trust is the only thing we sell.
            </p>
          </Reveal>

          <Reveal delay={200}>
            <div className="mt-10 space-y-10">
              <Section
                eyebrow="01"
                title="What we store on your device"
                body={
                  <>
                    <p>
                      Your uploaded documents are stored in your browser&apos;s local database
                      (IndexedDB). They are not uploaded to any server we run. If you sign out,
                      switch browsers, or clear your browsing data, the documents are gone from your
                      device — and they were never on ours to begin with.
                    </p>
                    <p>
                      We also keep a few small items in <code>localStorage</code>: your sign-in
                      email, your plan (Starter / Personal / Pro), and a random token that unlocks
                      voice features on paid plans. None of this contains your documents.
                    </p>
                  </>
                }
              />

              <Section
                eyebrow="02"
                title="What we send to a language model"
                body={
                  <>
                    <p>
                      When you ask a question, your browser runs a tiny local scoring pass that
                      picks the 3–4 paragraphs most likely to answer it. Only those paragraphs —
                      plus your question — leave the device, sent to
                      <strong> Groq</strong> over HTTPS. Groq returns the answer; we never store the
                      request or the answer.
                    </p>
                    <p>
                      The full document text is never transmitted. You can verify this yourself in
                      your browser&apos;s network tab — the request body contains only the
                      pre-scored snippets, not the entire file.
                    </p>
                    <p>
                      Groq&apos;s free tier is used for completions. Their privacy terms apply to
                      the request once it leaves our servers; we rely on Groq&apos;s
                      no-train-on-API-data policy.
                    </p>
                  </>
                }
              />

              <Section
                eyebrow="03"
                title="Voice — speech-to-text and text-to-speech"
                body={
                  <>
                    <p>
                      When you use the mic button, your browser&apos;s built-in SpeechRecognition
                      listens to your microphone and returns transcripts locally. The audio itself
                      is never recorded, uploaded, or stored by Telux.
                    </p>
                    <p>
                      When Talk with Document &quot;speaks&quot; an answer, your browser&apos;s
                      built-in SpeechSynthesis generates the audio locally. No audio is uploaded to
                      Telux.
                    </p>
                    <p>
                      Both APIs are language-aware. You can speak Hindi, Telugu, Tamil, Bengali,
                      Kannada, Malayalam, Marathi, Gujarati, Punjabi, English, or any other language
                      your browser supports — Talk with Document will reply in the same language.
                    </p>
                  </>
                }
              />

              <Section
                eyebrow="04"
                title="Account & authentication"
                body={
                  <>
                    <p>
                      Sign-up and login are handled by <strong>Supabase Auth</strong>. We store your
                      email address and a hashed password on Supabase servers. We never see or store
                      your password in plain text.
                    </p>
                    <p>
                      Session tokens are stored in your browser and refreshed automatically.
                      Disabling cookies or signing out ends the session immediately.
                    </p>
                  </>
                }
              />

              <Section
                eyebrow="05"
                title="What we do not collect"
                body={
                  <ul className="list-disc space-y-1.5 pl-5">
                    <li>No analytics, no tracking pixels, no Google Analytics.</li>
                    <li>No advertising IDs.</li>
                    <li>No document content stored on a server.</li>
                    <li>No audio recordings.</li>
                    <li>No model-request logs on our side.</li>
                  </ul>
                }
              />

              <Section
                eyebrow="06"
                title="Payments"
                body={
                  <p>
                    Paid plans will be processed by <strong>Razorpay</strong> (we are in the process
                    of wiring this up). Razorpay handles card data and billing — Telux never sees
                    your card number. We only receive confirmation that a payment succeeded and your
                    plan tier.
                  </p>
                }
              />

              <Section
                eyebrow="07"
                title="Your rights"
                body={
                  <>
                    <p>
                      You can delete every document from your device at any time using the trash
                      icon next to each file. You can sign out to clear your session. You can
                      request deletion of your Supabase account by emailing us — we will process it
                      within 7 days.
                    </p>
                    <p>
                      Because documents are never stored on our servers, deletion from your device
                      is final and immediate.
                    </p>
                  </>
                }
              />

              <Section
                eyebrow="08"
                title="Changes to this policy"
                body={
                  <p>
                    If we change anything material here, we&apos;ll bump the date below and surface
                    a banner in the app. We will never silently expand the data we collect.
                  </p>
                }
              />

              <Section
                eyebrow="09"
                title="Contact"
                body={
                  <p>
                    Questions, complaints, or deletion requests:{" "}
                    <a
                      href="mailto:privacy@telux.app"
                      className="text-signal underline-offset-4 hover:underline"
                    >
                      privacy@telux.app
                    </a>
                    . We respond within 7 days.
                  </p>
                }
              />

              <p className="pt-6 font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
                Last updated{" "}
                {new Date().toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </Reveal>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs tracking-widest text-signal uppercase">{eyebrow}</span>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>
      </div>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground md:text-base">
        {body}
      </div>
    </section>
  );
}
