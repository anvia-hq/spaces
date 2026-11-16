export type DownloadTransfer =
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_method" }
  | { ok: true; kind: "snapshot"; snapshotId: string; bytes: Uint8Array }
  | { ok: true; kind: "file"; name: string; bytes: Uint8Array };

export type UploadTransfer =
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_method" }
  | { ok: true; path: string; size: number };
