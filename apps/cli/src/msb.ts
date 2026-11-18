import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { exec } from "./exec.ts";
import type { ExecResult } from "./types.ts";

export async function locateMsb(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): Promise<string | undefined> {
  const candidates = [
    env.SPACES_MSB,
    join(homedir(), ".microsandbox", "bin", "msb"),
    join(homedir(), ".local", "bin", "msb"),
    ...(env.PATH ?? "").split(delimiter).map((dir) => join(dir, "msb")),
  ];

  for (const path of candidates) {
    if (path && exists(path)) return path;
  }

  return undefined;
}

export async function msbDoctor(msb: string): Promise<ExecResult> {
  const result = await exec([msb, "doctor"]);

  return result.out.includes("Host setup is ready")
    ? { ...result, code: 0 }
    : { ...result, code: 1 };
}
