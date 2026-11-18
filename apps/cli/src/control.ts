import type { TokenCheck } from "./types.ts";

const TIMEOUT_MS = 15_000;

export async function controlHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    return res.status === 200;
  } catch {
    return false;
  }
}

export async function checkToken(url: string, token: string): Promise<TokenCheck> {
  try {
    const res = await fetch(`${url}/runtime/connect`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401) {
      return {
        ok: false,
        message:
          "the control plane rejected that token. It belongs to another deployment, or it was rotated: copy the current one from the console.",
      };
    }

    return { ok: true, message: `accepted (HTTP ${res.status})` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!/^https?:\/\/[^\s/]+/.test(trimmed)) {
    throw new Error("--url must start with http:// or https://");
  }

  return trimmed;
}

export const TOKEN_PATTERN = /^spr_[0-9a-f]{48}$/;
