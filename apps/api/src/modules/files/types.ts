export type TransferMethod = "GET" | "PUT";

export interface TransferClaims {
  m: TransferMethod;
  s: string;
  p: string;
  e: number;
}

export type VerifyResult =
  | { ok: true; claims: TransferClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_method" };
