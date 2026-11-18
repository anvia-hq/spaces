import { describe, expect, test } from "bun:test";
import { boolFlag, parseArgs, stringFlag } from "./args.ts";

describe("parseArgs", () => {
  test("positionals and valued flags, in any order", () => {
    const args = parseArgs(["install", "--runtime", "--url", "https://x.test", "extra"], ["url"]);

    expect(args.positionals).toEqual(["install", "extra"]);
    expect(args.flags).toEqual({ runtime: true, url: "https://x.test" });
  });

  test("--name=value is accepted for any flag, and keeps an equals sign in the value", () => {
    const args = parseArgs(["--token=spr_a=b"]);

    expect(args.flags.token).toBe("spr_a=b");
  });

  test("a valued flag without a value is an error, even when another flag follows", () => {
    expect(() => parseArgs(["--url"], ["url"])).toThrow("--url needs a value");
    expect(() => parseArgs(["--url", "--runtime"], ["url", "runtime"])).toThrow(
      "--url needs a value",
    );
  });

  test("a flag that is not valued is a boolean", () => {
    const args = parseArgs(["--purge", "--yes"]);

    expect(boolFlag(args, "purge")).toBe(true);
    expect(boolFlag(args, "missing")).toBe(false);
  });

  test("stringFlag refuses a boolean, so --token with no value never becomes true", () => {
    const args = parseArgs(["--token"]);

    expect(() => stringFlag(args, "token")).toThrow("--token needs a value");
    expect(stringFlag(parseArgs([]), "token")).toBeUndefined();
  });
});
