import { useEffect, useState } from "react";
import { loadDocuments, type StoredDocument } from "@/lib/documents";

// Tiny subscription hook — re-reads from IndexedDB whenever some other part of
// the app saves or deletes a document. We don't cache chunks in React state
// because the chunks array can be heavy; consumers receive the list and only
// keep their own slice in memory.
export function useDocuments(userId?: string): { docs: StoredDocument[]; refresh: () => void } {
  const [docs, setDocs] = useState<StoredDocument[]>([]);

  const refresh = () => {
    if (!userId) {
      setDocs([]);
      return;
    }
    void loadDocuments(userId).then(setDocs);
  };

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener("telux:documents-changed", handler);
    return () => window.removeEventListener("telux:documents-changed", handler);
  }, [userId]);

  return { docs, refresh };
}
