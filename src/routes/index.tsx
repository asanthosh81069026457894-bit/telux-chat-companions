import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileText,
  HeartPulse,
  Landmark,
  Lock,
  MonitorSmartphone,
  ScrollText,
  ShieldCheck,
  Upload,
  WifiOff,
  MessageSquareText,
  Trash2,
  Check,
  Gift,
  Sparkles,
} from "lucide-react";

import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PLAN_LIMITS, TRIAL_DAYS, type BillingCycle } from "@/lib/usage";

const title = "Telux — Chat with your PDFs and reports, stored only on your device";
const description =
  "Telux lets you ask questions about PDFs, contracts, health papers and medical reports. Files stay in your own browser storage — Telux keeps nothing.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <Hero />
        <Steps />
        <Privacy />
        <UseCases />
        <Pricing />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ---------------------------------- 1. Hero --------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      <div className="pointer-events-none absolute inset-0 grid-veil" />
      <div className="pointer-events-none absolute inset-0 veil-glow" />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1.5">
              <span className="pulse-ring size-1.5 rounded-full bg-signal" />
              <span className="eyebrow">Zero-storage by design</span>
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-6 text-5xl leading-[0.95] font-bold md:text-7xl">
              Read in your language.
              <br />
              <span className="text-signal-gradient">Speak it.</span>
              <br />
              Think for yourself.
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
              Read your documents and talk back in any language. Drop in a PDF, a rental agreement,
              a lab report or a discharge summary — Telux answers in yours. Nothing is uploaded to a
              Telux server. Nothing is kept.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="rounded-full bg-signal px-6 py-3 font-semibold text-signal-foreground shadow-[var(--shadow-signal)] transition-transform hover:scale-[1.03]"
              >
                Start free — no card
              </Link>
              <a
                href="#how"
                className="rounded-full border border-border px-6 py-3 font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                See how it works
              </a>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Lock className="size-4 text-signal" /> Local-only file storage
              </li>
              <li className="flex items-center gap-2">
                <WifiOff className="size-4 text-signal" /> Nothing kept after you close the tab
              </li>
              <li className="flex items-center gap-2">
                <MonitorSmartphone className="size-4 text-signal" /> Works on phone & desktop
              </li>
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <HeroPanel />
        </Reveal>
      </div>

      <Marquee />
    </section>
  );
}

const heroTurns = [
  {
    q: "What does my report say about vitamin D?",
    a: "Your vitamin D reading is below the reference range given in the report. The document flags it and suggests discussing supplementation with your doctor.",
  },
  {
    q: "Which clauses cover early exit from this lease?",
    a: "Clause 9 allows exit with two months' written notice. Clause 11 adds a deduction from the deposit if you leave before month six.",
  },
  {
    q: "Switch language to हिन्दी and explain the photo in the document.",
    a: "भाषा बदली — अब हिन्दी में जवाब दूँगा। दस्तावेज़ में दो फोटो हैं: पहला पहले पन्ने पर हस्ताक्षर क्षेत्र के नीचे, दूसरा पन्ना 12 पर स्कैन के रूप में।",
  },
  {
    q: "Walk me through solving 3x + 5 = 20.",
    a: "Hint: start by isolating the term that has the variable. If 3x + 5 = 20, what can you subtract from both sides to keep the variable on the left? Your turn — solve step 1 and tell me what you get.",
  },
];

function HeroPanel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % heroTurns.length), 5200);
    return () => clearInterval(id);
  }, []);

  const turn = heroTurns[index];

  return (
    <div className="surface-card float-slow relative overflow-hidden p-5">
      <div className="scan-line pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,transparent,color-mix(in_oklab,var(--signal)_12%,transparent),transparent)]" />

      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <FileText className="size-4 text-signal" />
          <span className="font-mono text-xs">lab-report.pdf</span>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] tracking-widest uppercase">
          on device
        </span>
      </div>

      <div
        key={index}
        className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pt-5 duration-500"
      >
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-signal px-4 py-3 text-sm font-medium text-signal-foreground">
          {turn.q}
        </div>
        <div className="max-w-[92%] text-sm leading-relaxed text-muted-foreground">{turn.a}</div>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3">
        <MessageSquareText className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Ask anything about this file…</span>
        <span className="ml-auto size-2 rounded-full bg-signal" />
      </div>

      <div className="mt-4 flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        <ShieldCheck className="size-3.5 text-signal" />0 bytes written to Telux servers
      </div>
    </div>
  );
}

const marqueeItems = [
  "PDF",
  "Lab reports",
  "Prescriptions",
  "Rental agreements",
  "Insurance policies",
  "Scanned notes",
  "Discharge summaries",
  "Invoices",
  "Offer letters",
  "Study material",
];

function Marquee() {
  return (
    <div className="relative mt-20 overflow-hidden border-y border-border py-4">
      <div className="marquee-track flex w-max gap-10 pr-10">
        {[...marqueeItems, ...marqueeItems].map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="flex items-center gap-3 font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase"
          >
            <span className="size-1 rounded-full bg-signal" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- 2. How it works ----------------------------- */

const steps = [
  {
    icon: Upload,
    step: "01",
    title: "Add a file from your device",
    body: "Pick a PDF, image scan or text document. It is opened straight from your file picker into the browser — no upload dialog, no server round trip.",
  },
  {
    icon: MessageSquareText,
    step: "02",
    title: "Ask in your own words",
    body: "Hindi, English or a mix. Ask for a summary, a specific clause, a number buried on page 30, or what an abbreviation on a report means.",
  },
  {
    icon: Trash2,
    step: "03",
    title: "Close the tab, it's gone",
    body: "Your file lives in your browser's local storage until you clear it. One tap wipes every document and chat from the device permanently.",
  },
];

function Steps() {
  return (
    <section id="how" className="scroll-mt-24 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <span className="eyebrow">How it works</span>
          <h2 className="mt-4 max-w-2xl text-4xl font-bold md:text-5xl">
            Three steps. No account uploads, no cloud folder, no waiting.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.step} delay={i * 110}>
              <article className="surface-card group h-full p-7 transition-transform duration-500 hover:-translate-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-xl border border-border bg-surface-2 transition-colors group-hover:border-signal">
                    <s.icon className="size-5 text-signal" />
                  </span>
                  <span className="font-mono text-xs tracking-widest text-muted-foreground">
                    {s.step}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- 3. Privacy -------------------------------- */

const guarantees = [
  {
    icon: Lock,
    title: "Files stay in local storage",
    body: "Documents are held in your browser's own storage area, tied to your device — not to a Telux bucket.",
  },
  {
    icon: Trash2,
    title: "One-tap permanent wipe",
    body: "Clear everything instantly. There is no backup copy for us to delete, because one was never made.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing used for training",
    body: "Your medical and legal papers are never mined, profiled, sold, or fed into any model improvement loop.",
  },
];

function Privacy() {
  return (
    <section id="privacy" className="relative scroll-mt-24 overflow-hidden py-24 md:py-32">
      <div className="pointer-events-none absolute inset-0 veil-glow opacity-60" />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <span className="eyebrow">The promise</span>
          <h2 className="mt-4 text-4xl font-bold md:text-5xl">
            We can&apos;t leak what we never <span className="text-signal-gradient">hold</span>.
          </h2>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Most document tools ask you to hand over your files first. Telux inverts that. Your
            documents are read where they already are — on your device — and only the question you
            type is processed to build an answer.
          </p>

          <div className="mt-9 grid gap-3">
            {guarantees.map((g, i) => (
              <Reveal key={g.title} delay={i * 90}>
                <div className="flex gap-4 rounded-xl border border-border bg-surface/60 p-4">
                  <g.icon className="mt-0.5 size-5 shrink-0 text-signal" />
                  <div>
                    <p className="font-semibold">{g.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{g.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <Reveal delay={140}>
          <div className="surface-card p-8">
            <p className="eyebrow">Data map</p>
            <div className="mt-6 space-y-4">
              <MapRow label="Your document" value="Your device only" good />
              <MapRow label="Extracted text" value="Your device only" good />
              <MapRow label="Chat history" value="Your device only" good />
              <MapRow label="Your question" value="Processed, not retained" good />
              <MapRow label="Account email" value="Stored for login only" />
            </div>
            <p className="mt-8 border-t border-border pt-6 font-mono text-[11px] leading-relaxed tracking-widest text-muted-foreground uppercase">
              Telux storage footprint per document: 0 bytes
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function MapRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={
          good
            ? "flex items-center gap-2 text-sm font-medium text-signal"
            : "text-sm font-medium text-foreground"
        }
      >
        {good ? <Check className="size-3.5" /> : null}
        {value}
      </span>
    </div>
  );
}

/* -------------------------------- 4. Use cases -------------------------------- */

const useCases: Array<{ icon: typeof HeartPulse; title: string; body: string; id?: string }> = [
  {
    icon: HeartPulse,
    title: "Health & medical reports",
    body: "Understand a blood panel, a scan summary or a prescription without decoding jargon alone.",
  },
  {
    icon: ScrollText,
    title: "Agreements & contracts",
    body: "Find notice periods, penalties and renewal terms in a rental or employment document in seconds.",
  },
  {
    icon: Landmark,
    title: "Policies & statements",
    body: "Ask what an insurance policy actually covers, or trace a charge across a long bank statement.",
  },
  {
    icon: FileText,
    title: "Study & work material",
    body: "Turn dense papers, manuals and notes into answers, checklists and revision-ready summaries.",
  },
];

function UseCases() {
  return (
    <section id="usecases" className="scroll-mt-24 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <span className="eyebrow">Built for real paperwork</span>
          <h2 className="mt-4 max-w-2xl text-4xl font-bold md:text-5xl">
            The documents you&apos;d never upload to a random website.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {useCases.map((u, i) => (
            <Reveal key={u.title} delay={i * 90}>
              <article
                id={u.id}
                className="group relative h-full overflow-hidden rounded-2xl border border-border bg-surface p-8 transition-colors hover:border-signal/50"
              >
                <div className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-signal/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                <u.icon className="size-6 text-signal" />
                <h3 className="mt-6 text-2xl font-semibold">{u.title}</h3>
                <p className="mt-3 max-w-md text-muted-foreground">{u.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- 5. Pricing --------------------------------- */

// Pricing block is data-driven from PLAN_LIMITS so the on-page numbers
// match the Billing page exactly. The monthly/yearly toggle recomputes the
// `price` and `period` strings on the fly; the comparison rows highlight
// the savings when the user picks yearly.

const LANDING_TIERS: Array<{
  key: "starter" | "personal" | "pro";
  tagline: string;
  featured: boolean;
}> = [
  { key: "starter", tagline: "For trying Telux on a few files.", featured: false },
  {
    key: "personal",
    tagline: "For health records, bills and agreements.",
    featured: true,
  },
  { key: "pro", tagline: "For heavy document work all week.", featured: false },
];

function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>("yearly");

  return (
    <section id="pricing" className="scroll-mt-24 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <span className="eyebrow">Pricing</span>
          <h2 className="mt-4 text-4xl font-bold md:text-5xl">Simple plans, priced in rupees.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            GST included. Cancel any time — your documents were never with us to begin with.
          </p>
        </Reveal>

        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setCycle("monthly")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
              (cycle === "monthly"
                ? "bg-signal text-signal-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setCycle("yearly")}
            className={
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors " +
              (cycle === "yearly"
                ? "bg-signal text-signal-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Yearly
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase">
              Save 20%
            </span>
          </button>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {LANDING_TIERS.map((t, i) => {
            const plan = PLAN_LIMITS[t.key];
            const isYearly = cycle === "yearly";
            const priceRupees = isYearly ? plan.priceYearly : plan.priceMonthly;
            const period =
              plan.priceMonthly === 0 ? "free, forever" : isYearly ? "per year" : "per month";
            const unitLabel =
              isYearly && plan.priceMonthly > 0
                ? `≈ ₹${Math.round(priceRupees / 12)} / month`
                : null;
            return (
              <Reveal key={t.key} delay={i * 110}>
                <article
                  className={
                    t.featured
                      ? "relative h-full rounded-2xl border border-signal/60 bg-surface-2 p-8 shadow-[var(--shadow-signal)]"
                      : "surface-card h-full p-8"
                  }
                >
                  {t.featured ? (
                    <span className="absolute -top-3 left-8 rounded-full bg-signal px-3 py-1 font-mono text-[10px] tracking-widest text-signal-foreground uppercase">
                      Most chosen
                    </span>
                  ) : null}
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t.tagline}</p>
                  <p className="mt-7 flex items-baseline gap-2">
                    <span className="font-display text-5xl font-bold">
                      {priceRupees === 0 ? "₹0" : `₹${priceRupees.toLocaleString("en-IN")}`}
                    </span>
                    <span className="text-sm text-muted-foreground">{period}</span>
                  </p>
                  {unitLabel ? <p className="mt-1 text-xs text-emerald-400">{unitLabel}</p> : null}
                  {isYearly && plan.featuresYearlyBadge ? (
                    <p className="mt-1 text-xs font-medium text-emerald-400">
                      {plan.featuresYearlyBadge}
                    </p>
                  ) : null}
                  <ul className="mt-7 space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-3 text-sm text-muted-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-signal" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={
                      t.featured
                        ? "mt-8 block rounded-full bg-signal px-5 py-3 text-center font-semibold text-signal-foreground transition-transform hover:scale-[1.02]"
                        : "mt-8 block rounded-full border border-border px-5 py-3 text-center font-medium transition-colors hover:bg-surface-2"
                    }
                  >
                    {plan.priceMonthly === 0 ? "Start free" : `Get ${plan.name}`}
                  </Link>
                </article>
              </Reveal>
            );
          })}
        </div>

        {/* Trial CTA — single line under the pricing cards. */}
        <Reveal delay={120}>
          <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-signal/40 bg-gradient-to-br from-signal/15 via-signal/5 to-transparent p-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 font-mono text-[10px] tracking-widest text-signal uppercase">
              <Gift className="size-3.5" />
              {TRIAL_DAYS}-day free trial
            </span>
            <h3 className="text-2xl font-semibold sm:text-3xl">
              Try Talk with Document free for {TRIAL_DAYS} days
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Sign up and start the trial — every paid feature unlocks for a week, no card needed.
              Cancel any time from the Billing page.
            </p>
            <Link
              to="/signup"
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-signal px-6 py-3 font-semibold text-signal-foreground shadow-[var(--shadow-signal)] transition-transform hover:scale-[1.03]"
            >
              <Sparkles className="size-4" />
              Start your free trial
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------- 6. FAQ ----------------------------------- */

const faqs = [
  {
    q: "Where exactly are my documents stored?",
    a: "In your browser's local storage on the device you used. They are not copied to a Telux database, bucket or backup. Clearing Telux data or your browser data removes them for good.",
  },
  {
    q: "What happens when I ask a question?",
    a: "Only the relevant text you are asking about plus your question is used to produce the answer. It is processed to generate the reply and is not written to any Telux store afterwards.",
  },
  {
    q: "Can I open the same document on another device?",
    a: "No — and that is intentional. Since nothing syncs to a server, a document added on your phone stays on your phone. Add the file again on the other device to continue there.",
  },
  {
    q: "Is Telux a substitute for a doctor or lawyer?",
    a: "No. Telux helps you read and understand your own paperwork in plain language. Decisions about treatment or legal action should always be taken with a qualified professional.",
  },
  {
    q: "How do payments work?",
    a: "Plans are billed in Indian rupees either monthly or yearly (yearly saves 20%). Pay with card, UPI, or netbanking through Razorpay — cancel any time from the Billing page. Downgrading never touches your documents, because they live on your device.",
  },
  {
    q: "What's included in the free trial?",
    a: `A ${TRIAL_DAYS}-day Personal trial unlocks every paid feature: unlimited questions, Talk with Document in any language, and the voice gender picker. No card required. Cancel any time from the dashboard banner.`,
  },
];

function Faq() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 lg:grid-cols-[0.85fr_1.15fr]">
        <Reveal>
          <span className="eyebrow">Questions</span>
          <h2 className="mt-4 text-4xl font-bold md:text-5xl">Everything people ask first.</h2>
          <div className="surface-card mt-10 p-7">
            <p className="text-lg font-semibold">Ready to try it on one file?</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Free plan, no card, and nothing of yours stays with us.
            </p>
            <Link
              to="/signup"
              className="mt-6 inline-block rounded-full bg-signal px-6 py-3 font-semibold text-signal-foreground transition-transform hover:scale-[1.03]"
            >
              Create your account
            </Link>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((f) => (
              <AccordionItem key={f.q} value={f.q} className="border-border">
                <AccordionTrigger className="text-left text-base font-medium hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
