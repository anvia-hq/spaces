import { parseArgs } from "./args.ts";
import { doctor } from "./commands/doctor.ts";
import { defaultInstallDeps, runtimeInstall } from "./commands/install.ts";
import { runtimeControl, runtimeLogs, runtimeRun, runtimeStatus } from "./commands/runtime.ts";
import { uninstall } from "./commands/uninstall.ts";
import { update } from "./commands/update.ts";

const VALUED = ["url", "token", "public-host", "image"];

const HELP = `spaces: install and manage a spaces runtime on this machine

  spaces install --runtime --url <control plane> --token <token>
                  [--public-host <host>] [--image <ref>]
  spaces runtime status | logs [--follow] | restart | stop | start | run
  spaces doctor
  spaces update
  spaces uninstall [--purge --yes]

A runtime runs sandboxes for a control plane and dials out to it, so it needs no inbound port.
Register one in the console (Runtimes) to get the command with its token.`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, VALUED);
  const [command, subcommand] = args.positionals;

  switch (command) {
    case undefined:
    case "help":
      console.log(HELP);
      return 0;
    case "install":
      await runtimeInstall(args, defaultInstallDeps());
      return 0;
    case "doctor":
      return await doctor();
    case "update":
      return await update();
    case "uninstall":
      await uninstall(args);
      return 0;
    case "runtime":
      return await runtimeCommand(subcommand, args);
    default:
      console.error(`unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

async function runtimeCommand(subcommand: string | undefined, args: ReturnType<typeof parseArgs>) {
  switch (subcommand) {
    case "run":
      await runtimeRun();
      return await new Promise<number>(() => undefined);
    case "status":
      await runtimeStatus();
      return 0;
    case "logs":
      await runtimeLogs(args);
      return 0;
    case "start":
    case "stop":
    case "restart":
      await runtimeControl(subcommand);
      return 0;
    default:
      console.error(`unknown runtime command: ${subcommand ?? ""}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
