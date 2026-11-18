import type { ExecResult } from "./types.ts";

export async function exec(
  command: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<ExecResult> {
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;

    return { code, out: `${out}${err}`.trim() };
  } catch (error) {
    return { code: 127, out: error instanceof Error ? error.message : String(error) };
  }
}
