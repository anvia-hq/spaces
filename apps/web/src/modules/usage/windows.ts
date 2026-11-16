import type { Window } from "./types.ts";

export const WINDOWS: readonly { value: Window; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "24h" },
  { value: "1h", label: "1h" },
];
