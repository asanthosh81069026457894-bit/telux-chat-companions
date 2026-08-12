// History page content. Shows uploaded documents with a "Manage billing →"
// link that navigates to /billing.

import { Link } from "@tanstack/react-router";
import { FileText, Inbox, Trash2 } from "lucide-react";

import { useDocuments } from "@/hooks/useDocuments";
import { clearAllDocuments, deleteDocument } from "@/lib/documents";

import { useAuth } from "@/hooks/useAuth";
import { useUsage } from "@/hooks/useUsage";

export function DashboardHistorySection() {
  const { user } = useAuth();
  const { docs, refresh } = useDocuments(user?.id);
  const { plan } = useUsage();

  return (
    <section className="rounded-2xl border border-border bg-surface-2/30 p-5 sm:p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">History</span>
          <h2 className="mt-2 text-2xl font-semibold">Documents on this device</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored in your browser only. Delete anything you no longer need.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/billing"
            className="text-xs font-medium text-signal transition-colors hover:underline"
          >
            Manage billing →
          </Link>
          {docs.length > 0 ? (
            <button
              type="button"
              onClick={async () => {
                if (!user?.id) return;
                const note =
                  plan === "starter"
                    ? "\n\nNote: clearing documents resets your Talk with Document free-trial count on Starter."
                    : "";
                if (
                  window.confirm(`Delete all ${docs.length} documents from this device?${note}`)
                ) {
                  await clearAllDocuments(user.id);
                  refresh();
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/15"
            >
              <Trash2 className="size-3.5" />
              Clear all
            </button>
          ) : null}
        </div>
      </header>

      {docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-2/30 py-16 text-center">
          <Inbox className="size-10 text-muted-foreground" />
          <h3 className="text-base font-semibold">No documents yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Upload a document in the workspace above. It will appear here, and only here on this
            device.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal/15 text-signal">
                <FileText className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatSize(d.size)} · {formatDate(d.addedAt)} · {d.chunks.length} chunks
                </p>
              </div>
              <button
                type="button"
                aria-label={`Delete ${d.name}`}
                onClick={async () => {
                  await deleteDocument(d.id);
                  refresh();
                }}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
