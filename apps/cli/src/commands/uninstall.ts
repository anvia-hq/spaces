import { rm } from "node:fs/promises";
import { boolFlag } from "../args.ts";
import { spacesHome } from "../home.ts";
import { RUNTIME_SERVICE, serviceManager } from "../service-manager.ts";
import type { Args } from "../types.ts";

export async function uninstall(args: Args): Promise<void> {
  const purge = boolFlag(args, "purge");

  if (purge && !boolFlag(args, "yes")) {
    throw new Error(
      "--purge deletes the runtime's settings, log and source: add --yes to confirm.",
    );
  }

  await serviceManager(RUNTIME_SERVICE).uninstall();
  console.log("The runtime service is removed. Sandboxes already on this machine are untouched.");

  if (!purge) {
    console.log(
      `Settings and source are kept in ${spacesHome()}. Add --purge --yes to delete them.`,
    );
    return;
  }

  await rm(spacesHome(), { recursive: true, force: true });
  console.log(`Deleted ${spacesHome()}.`);
}
