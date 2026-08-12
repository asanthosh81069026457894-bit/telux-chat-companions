// Document text extraction, chunking, and on-device persistence.
//
// Privacy: text never leaves the user's browser. We extract in the browser,
// chunk in the browser, and store the chunks in IndexedDB under a Telux DB.
// The /api/chat serverFn later receives only the *top-scoring chunks* (already
// picked client-side) — see src/lib/scoring.ts.

export type StoredDocument = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  addedAt: number;
  chunks: string[];
  // Total PDF page count for the source file. Zero for plain-text files.
  // Used to enforce the per-account page cap (50 / 200 / 1,000 / unlimited).
  pageCount: number;
  userId?: string;
};

// ----- Extraction -------------------------------------------------------------

export type ExtractResult = {
  text: string;
  pageCount: number;
};

export async function extractText(file: File): Promise<string> {
  const result = await extractTextWithMeta(file);
  return result.text;
}

export async function extractTextWithMeta(file: File): Promise<ExtractResult> {
  const lower = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  if (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json")
  ) {
    const text = await file.text();
    return { text, pageCount: 0 };
  }
  // Reject unsupported binaries (.docx, images, .zip, etc.) loudly so the user
  // sees a real error instead of a "silent empty doc" that breaks the chat.
  throw new Error(
    `Unsupported file type: ${file.type || file.name}. Only PDF, TXT, MD, CSV and JSON are supported on the Starter plan.`,
  );
}

async function extractPdfText(file: File): Promise<ExtractResult> {
  // Lazy-load pdfjs-dist so it doesn't bloat the initial bundle for users who
  // never upload a PDF. The worker is configured via a CDN URL to avoid having
  // to ship the worker as an asset through the bundler.
  const pdfjs = await import("pdfjs-dist");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib: any = (pdfjs as any).default ?? pdfjs;
  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  }

  const buffer = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buffer }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .filter(Boolean);
    parts.push(strings.join(" "));
  }
  return { text: parts.join("\n\n"), pageCount: doc.numPages ?? parts.length };
}

// ----- Chunking ---------------------------------------------------------------

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 1000;
  const overlap = Math.min(opts.overlap ?? 100, Math.floor(size / 4));
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

// ----- IndexedDB persistence --------------------------------------------------

const DB_NAME = "telux";
const DB_VERSION = 1;
const STORE = "documents";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    if (result instanceof Promise) {
      result.then(resolve, reject);
      return;
    }
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
  });
}

export async function loadDocuments(userId: string): Promise<StoredDocument[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    const all = await tx<StoredDocument[]>(
      db,
      "readonly",
      (store) => store.getAll() as IDBRequest<StoredDocument[]>,
    );
    // Newest first.
    return all
      .filter((d) => !d.userId || d.userId === userId)
      .sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveDocument(doc: StoredDocument): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Refuse to persist a document with no readable text — this is the difference
  // between "uploaded" and "the chat can actually answer from it". Surfaces
  // scanned PDFs and edge cases where pdfjs returned nothing.
  if (!doc.chunks || doc.chunks.length === 0) {
    throw new Error(
      "Document produced no readable text — it may be a scanned PDF or image-only file. Try a text-based PDF.",
    );
  }
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.put(doc));
  notifyChange();
}

export async function deleteDocument(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.delete(id));
  notifyChange();
}

export async function clearAllDocuments(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const all = await tx<StoredDocument[]>(
    db,
    "readonly",
    (store) => store.getAll() as IDBRequest<StoredDocument[]>,
  );
  const toDelete = all.filter((d) => !d.userId || d.userId === userId).map((d) => d.id);

  if (toDelete.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const id of toDelete) {
      store.delete(id);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  notifyChange();
}

// Convenience: collect every chunk across every document so the chat panel can
// run scoreChunks() against the whole on-device library at once.
export function allChunks(docs: StoredDocument[]): string[] {
  const out: string[] = [];
  for (const d of docs) out.push(...d.chunks);
  return out;
}

function notifyChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("telux:documents-changed"));
}
