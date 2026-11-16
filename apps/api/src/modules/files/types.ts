export type TransferMethod = "GET" | "PUT";

export interface TransferClaims {
  /** GET = download, PUT = upload. */
  m: TransferMethod;
  /** Sandbox id. */
  s: string;
  /** Absolute sandbox path. */
  p: string;
  /** Expiry, epoch seconds. */
  e: number;
}

export type VerifyResult =
  | { ok: true; claims: TransferClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_method" };
