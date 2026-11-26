import { config } from "./config.ts";

export function publicOrigin(url: string): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");

  return new URL(url).origin;
}
