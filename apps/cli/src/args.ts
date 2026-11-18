import type { Args } from "./types.ts";

export function parseArgs(argv: string[], valued: string[] = []): Args {
  const args: Args = { positionals: [], flags: {} };

  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index]!;

    if (!word.startsWith("--")) {
      args.positionals.push(word);
      continue;
    }

    const [name, inline] = word.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];

    if (inline !== undefined) {
      args.flags[name] = inline;
      continue;
    }

    if (!valued.includes(name)) {
      args.flags[name] = true;
      continue;
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);

    args.flags[name] = value;
    index += 1;
  }

  return args;
}

export function stringFlag(args: Args, name: string): string | undefined {
  const value = args.flags[name];

  if (value === true) throw new Error(`--${name} needs a value`);

  return typeof value === "string" ? value : undefined;
}

export function boolFlag(args: Args, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === "true";
}
