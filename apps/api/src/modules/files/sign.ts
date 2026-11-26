import { config } from "../../config.ts";
import type { TransferClaims, TransferMethod, VerifyResult } from "./types.ts";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(config.signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(new Uint8Array(sig));
}

export async function mintTransferToken(claims: TransferClaims): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload)}`;
}

export async function verifyTransferToken(
  token: string,
  method: TransferMethod,
): Promise<VerifyResult> {
  const dot = token.indexOf(".");

  if (dot < 1) return { ok: false, reason: "malformed" };

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = await sign(payload);

  if (provided.length !== expected.length) return { ok: false, reason: "bad_signature" };

  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: "bad_signature" };

  let claims: TransferClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TransferClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (claims.e * 1000 <= Date.now()) return { ok: false, reason: "expired" };

  if (claims.m !== method) return { ok: false, reason: "wrong_method" };

  return { ok: true, claims };
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
