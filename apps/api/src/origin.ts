import { config } from "./config.ts";

/** Public origin to put in a signed URL: configured, else the request's own. */
export function publicOrigin(url: string): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");

  return new URL(url).origin;
}
