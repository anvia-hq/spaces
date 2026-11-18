import { stat } from "node:fs/promises";
import { installScript, spacesHome } from "../home.ts";

export async function update(): Promise<number> {
  const script = installScript(spacesHome());

  if (!(await stat(script).catch(() => undefined))) {
    throw new Error(
      `${script} is missing. Run the install command from the console again, without a new token: it keeps the settings.`,
    );
  }

  const proc = Bun.spawn(["bash", script, "--runtime"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  return await proc.exited;
}
