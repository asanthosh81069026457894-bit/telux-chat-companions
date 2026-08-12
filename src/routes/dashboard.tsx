import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, FileText, Gift, LoaderCircle, UploadCloud, Volume2, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";

import { DashboardSubNav } from "@/components/dashboard-nav";
import { AuthGate } from "@/components/AuthGate";
import { ChatPanel } from "@/components/ChatPanel";
import { DashboardStateProvider } from "@/components/dashboard-state";
import { useAuth } from "@/hooks/useAuth";
import { useDocuments } from "@/hooks/useDocuments";
import { useUsage } from "@/hooks/useUsage";
import { chunkText, deleteDocument, extractTextWithMeta, saveDocument } from "@/lib/documents";
import {
  canUploadDocument,
  pageCapFor,
  remainingSlots,
  STARTER_DOC_LIMIT,
  uploadBlockReason,
} from "@/lib/usage";
import { toast } from "sonner";
import { cancelTrial as serverCancelTrial } from "@/serverFns/subscription";
import { emitSubscriptionChange, loadSubscription } from "@/lib/subscription";

const title = "Dashboard — Telux";
const description =
  "Chat with your documents. Files stay on your device; only the relevant excerpt leaves.";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AuthGate>
      <DashboardPage />
    </AuthGate>
  ),
});

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DashboardPage() {
  // AuthGate guarantees session is non-null here.
  const { session } = useAuth();
  const navigate = useNavigate();
  const { docs } = useDocuments(session?.user?.id);
  // AuthGate has already kicked off loadSubscription() in the background;
  // we don't refetch on mount because that would double-trip the serverFn
  // and re-introduce the loading flash.
  const routerState = useRouterState();
  // Read ?view= from URL with a soft fallback so legacy Link callsites without
  // a search param still work.
  const viewRaw = new URLSearchParams(routerState.location.search).get("view");
  const view: "chat" | "documents" = viewRaw === "chat" ? "chat" : "documents";
  // Mobile-only tab switcher. On `lg+` the workspace renders both panels
  // side-by-side so this state has no effect.
  const [mobileTab, setMobileTab] = useState<"documents" | "chat">(view);
  const [isDragging, setIsDragging] = useState(false);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  // Shown when a Starter user tries to upload past the 3-doc free cap.
  const [uploadPaywallOpen, setUploadPaywallOpen] = useState(false);
  // After the first successful upload, surface a quick CTA pointing at /talk.
  // One-time per session — we don't keep nagging the user once they've seen it.
  const [firstUploadCelebrated, setFirstUploadCelebrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read the plan so ingest() can enforce the upload cap on Starter.
  // useUsage() must be called unconditionally (Rules of Hooks), so it sits
  // above the early returns below.
  const { effectivePlan, trialUntil, trialDaysRemaining, billingCycle } = useUsage();

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      if (!session?.user?.id) return;
      const fileArr = Array.from(files);
      // Page total across what's already on this device. Newly added files
      // pre-count with their own page count and the upload is aborted if the
      // running total would exceed the plan cap (see Supabase `documents`
      // table for the server-side mirror).
      const runningTotalPages = docs.reduce((sum, d) => sum + (d.pageCount ?? 0), 0);
      // Hard upload cap: Starter gets 10 docs / 50 pages. After that, the
      // paywall modal opens and the upload is aborted before any work. Trial
      // users get Personal-level unlimited uploads via effectivePlan().
      if (
        !canUploadDocument(effectivePlan, docs.length, runningTotalPages, undefined, billingCycle)
      ) {
        setUploadPaywallOpen(true);
        return;
      }
      // Be defensive: if the user drops more files than their remaining slots
      // allow, block the lot. Persisted cap count is docs.length (already
      // includes in-flight reads but not yet-saved ones).
      const slots = remainingSlots(effectivePlan, docs.length);
      if (fileArr.length > slots) {
        setUploadPaywallOpen(true);
        return;
      }
      let savedSomething = false;
      let usedPages = 0;
      for (const file of fileArr) {
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        setIngestingId(id);
        try {
          const { text, pageCount } = await extractTextWithMeta(file);
          // Refuse the upload up-front if it would push the user over their
          // page cap. Yearly Pro is uncapped (pageCapFor returns Infinity).
          const after = runningTotalPages + usedPages + pageCount;
          const plan = effectivePlan;
          const cap = pageCapFor(plan, billingCycle);
          if (Number.isFinite(cap) && after > cap) {
            toast.error(
              `Uploading ${file.name} would exceed your ${cap}-page limit. Upgrade for more room.`,
            );
            continue;
          }
          const chunks = chunkText(text);
          await saveDocument({
            id,
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            addedAt: Date.now(),
            chunks,
            pageCount,
            userId: session.user.id,
          });
          usedPages += pageCount;
          savedSomething = true;
        } catch (err) {
          console.error("Failed to ingest", file.name, err);
          const detail =
            err instanceof Error
              ? err.message
              : "Only PDF and plain-text files are supported on the Starter plan.";
          toast.error(`Couldn't read "${file.name}". ${detail}`);
        } finally {
          setIngestingId(null);
        }
      }
      // After the very first successful upload, briefly surface the
      // Talk-with-Document CTA inside the documents panel so the user
      // knows where to go next. On mobile, also auto-switch to the chat
      // tab — that's the natural next step ("upload → ask").
      if (savedSomething && !firstUploadCelebrated) {
        setFirstUploadCelebrated(true);
      }
      if (savedSomething) {
        setMobileTab("chat");
      }
    },
    [session?.user?.id, effectivePlan, docs, billingCycle, firstUploadCelebrated],
  );

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    void ingest(e.dataTransfer.files);
  }

  return (
    <DashboardStateProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <DashboardSubNav />

        <TrialBanner
          visible={trialUntil != null}
          daysRemaining={trialDaysRemaining}
          onCancel={async () => {
            if (!session?.user?.id) return;
            try {
              await serverCancelTrial({ data: { userId: session.user.id } });
              await loadSubscription(session.user.id, { force: true });
              emitSubscriptionChange();
            } catch (err) {
              console.error("Failed to cancel trial", err);
            }
          }}
        />

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-3 pb-6 pt-3 sm:px-6 sm:pt-6">
          {/* Mobile-only tab switcher. On desktop both panels render side by
              side so this row is hidden via lg:hidden. The Documents tab
              shows the document list (left column on desktop), the Chat
              tab swaps in the chat panel as the focused workspace. */}
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2/40 p-1 text-xs lg:hidden">
            <button
              type="button"
              onClick={() => setMobileTab("documents")}
              className={
                "rounded-lg px-3 py-2 font-medium transition-colors " +
                (mobileTab === "documents"
                  ? "bg-signal text-signal-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              Documents
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("chat")}
              className={
                "rounded-lg px-3 py-2 font-medium transition-colors " +
                (mobileTab === "chat"
                  ? "bg-signal text-signal-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              Chat
            </button>
          </div>

          {/* Workspace. On `lg+` the right column always renders the panel
              matching the active tab; documents stays in the left column.
              On mobile, only the active tab's panel renders. */}
          <main className="grid min-h-[calc(100vh-7rem)] grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-5">
            {/* Documents panel — hidden on mobile unless documents tab is
                active. */}
            <div className={mobileTab === "documents" ? "" : "hidden lg:block"}>
              <DocumentsPanel
                docs={docs}
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                ingestingId={ingestingId}
                firstUploadCelebrated={firstUploadCelebrated}
                onDrop={onDrop}
                onPick={() => fileInputRef.current?.click()}
                fileInputRef={fileInputRef}
                ingest={ingest}
              />
            </div>

            {/* Right column — Chat panel. On desktop it always renders
                alongside the documents list; on mobile it only shows
                when the Chat tab is active. */}
            <div className={mobileTab === "documents" ? "hidden lg:block" : ""}>
              <ChatPanel docs={docs} />
            </div>
          </main>
        </div>

        {/* Talk-with-Document upload paywall — appears when a Starter user
            tries to upload past the 3-doc free cap. */}
        <UploadPaywallModal
          open={uploadPaywallOpen}
          reason={
            uploadBlockReason(
              effectivePlan,
              docs.length,
              docs.reduce((sum, d) => sum + (d.pageCount ?? 0), 0),
              undefined,
              billingCycle,
            ) ?? undefined
          }
          onClose={() => setUploadPaywallOpen(false)}
          onViewPlans={() => {
            setUploadPaywallOpen(false);
            void navigate({ to: "/billing" });
          }}
        />
      </div>
    </DashboardStateProvider>
  );
}

/**
 * Compact, dismissible banner shown above the workspace while a Personal trial
 * is active. Pulled out of DashboardPage so the latter stays focused on the
 * workspace; the banner is a pure presentational wrapper around the trial
 * state surfaced by useUsage().
 */
function TrialBanner({
  visible,
  daysRemaining,
  onCancel,
}: {
  visible: boolean;
  daysRemaining: number;
  onCancel: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="border-b border-signal/30 bg-signal/10">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
        <span className="flex items-center gap-2 text-foreground">
          <Gift className="size-3.5 shrink-0 text-signal" />
          <span>
            <span className="font-semibold text-signal">Trial active</span> — {daysRemaining}{" "}
            {daysRemaining === 1 ? "day" : "days"} left of Pro
          </span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-signal/15 hover:text-signal"
        >
          Cancel trial
        </button>
      </div>
    </div>
  );
}

type DocsProps = {
  docs: ReturnType<typeof useDocuments>["docs"];
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  ingestingId: string | null;
  firstUploadCelebrated: boolean;
  onDrop: (e: DragEvent<HTMLLabelElement>) => void;
  onPick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  ingest: (files: FileList | File[]) => Promise<void>;
};

function DocumentsPanel({
  docs,
  isDragging,
  setIsDragging,
  ingestingId,
  firstUploadCelebrated,
  onDrop,
  fileInputRef,
  ingest,
}: DocsProps) {
  // Show free-trial progress under the drop-zone when on Starter. Trial users
  // are treated as Personal via effectivePlan(), so they skip the cap warning.
  const { effectivePlan } = useUsage();
  const slots = remainingSlots(effectivePlan, docs.length);
  const capReached = effectivePlan === "starter" && slots <= 0;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/30 p-3.5 sm:p-5">
      <header className="flex items-center gap-2">
        <h1 className="text-base font-semibold sm:text-lg">Documents</h1>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          On this device
        </span>
      </header>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (capReached) return;
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={
          "flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-surface-2/30 p-4 text-center transition-colors sm:p-6 " +
          // Mobile gets a tighter drop-zone so the chat panel can sit on the
          // same screen height without scrolling. Desktop keeps the spacious
          // 220 px so the upload area feels inviting.
          "min-h-[150px] sm:min-h-[220px] " +
          (capReached
            ? "cursor-not-allowed border-border opacity-60"
            : "cursor-pointer " +
              (isDragging ? "border-signal bg-signal/5" : "border-border hover:border-signal/60"))
        }
      >
        <UploadCloud className="size-7 text-signal sm:size-8" />
        <div>
          <p className="text-sm font-medium">
            {capReached ? "Free document slots used" : "Drag & drop a file here"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {capReached
              ? `Upgrade to Personal for unlimited documents.`
              : "PDF, TXT, MD up to ~10 MB"}
          </p>
        </div>
        <span className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-medium">
          {capReached ? "View plans" : "Choose file"}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
          className="sr-only"
          disabled={capReached}
          onChange={(e) => {
            if (capReached) return;
            if (e.currentTarget.files) void ingest(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {ingestingId ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Reading document…
        </p>
      ) : null}

      {docs.length > 0 ? (
        <ul className="space-y-2">
          {docs.slice(0, 6).map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2"
            >
              <FileText className="size-4 shrink-0 text-signal" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatSize(d.size)} · {d.chunks.length} chunks
                  {d.pageCount ? ` · ${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => void deleteDocument(d.id)}
                className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {docs.length > 6 ? (
            <li className="text-center text-xs text-muted-foreground">
              + {docs.length - 6} more on this device
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Single, prominent CTA into the voice workspace. One entry point is
          enough — the dashboard sub-nav also links to /talk for keyboard
          users. We surface this the moment the user has a document ready so
          the path from "upload" to "talk" is one tap. */}
      {firstUploadCelebrated && docs.length > 0 ? (
        <Link
          to="/talk"
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-signal/40 bg-signal/10 px-4 py-3 text-sm font-semibold text-signal transition-colors hover:bg-signal/15"
        >
          <Volume2 className="size-4" />
          Talk with Document
        </Link>
      ) : null}
    </section>
  );
}

function UploadPaywallModal({
  open,
  reason,
  onClose,
  onViewPlans,
}: {
  open: boolean;
  reason?: string;
  onClose: () => void;
  onViewPlans: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-paywall-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <div className="grid size-12 place-items-center rounded-full border border-signal/40 bg-signal/10 text-signal">
          <UploadCloud className="size-5" />
        </div>
        <h2 id="upload-paywall-title" className="mt-4 text-xl font-semibold">
          You&apos;ve used all {STARTER_DOC_LIMIT} free document slots
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {reason ??
            `Talk with Document is included on Personal and Pro plans. Upgrade to upload unlimited documents and keep talking to them in any language.`}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onViewPlans}
            className="inline-flex items-center gap-1.5 rounded-full bg-signal px-5 py-2.5 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.02]"
          >
            View plans <ArrowRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
