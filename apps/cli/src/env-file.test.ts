import { describe, expect, test } from "bun:test";
import { parseEnv, setEnv } from "./env-file.ts";

describe("env files", () => {
  test("parse reads KEY=VALUE lines and ignores comments and blanks", () => {
    expect(parseEnv("# note\n\nA=1\nB=two words\nnot a line\nC=\n")).toEqual({
      A: "1",
      B: "two words",
      C: "",
    });
  });

  test("a value keeps any equals sign and quotes literally", () => {
    expect(parseEnv('K=a=b"c"\n')).toEqual({ K: 'a=b"c"' });
  });

  test("set replaces in place and keeps comments and order", () => {
    const text = "# head\nA=1\n# mid\nB=2\n";

    expect(setEnv(text, { A: "9" })).toBe("# head\nA=9\n# mid\nB=2\n");
  });

  test("set appends what is missing, after exactly one newline", () => {
    expect(setEnv("A=1", { B: "2" })).toBe("A=1\nB=2\n");
    expect(setEnv("A=1\n\n\n", { B: "2" })).toBe("A=1\nB=2\n");
  });

  test("a key never glues onto the previous value", () => {
    const out = setEnv("A=1", { B: "2", C: "3" });

    expect(parseEnv(out)).toEqual({ A: "1", B: "2", C: "3" });
  });

  test("a value with a backslash or pipe is written untouched", () => {
    expect(parseEnv(setEnv("", { P: "a|b\\c&d" }))).toEqual({ P: "a|b\\c&d" });
  });
});
