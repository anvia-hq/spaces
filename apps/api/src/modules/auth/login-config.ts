import { config } from "../../config.ts";
import type { LoginConfig } from "./types.ts";

export function loginConfig(): LoginConfig {
  return { github: config.auth.github.enabled };
}
