/**
 * GitHub sign-in is configured by the environment and by nothing else: both
 * halves of the OAuth pair register the provider, either half missing leaves it
 * out, and `/api/v1/me` reports the same answer to the console.
 *
 * Each case boots the API in a subprocess (`src/testing/boot-probe.ts`) because
 * `config` and the Better Auth instance are built at import time. No case
 * reaches github.com: a sign-in attempt is answered by Better Auth itself —
 * `404` with no provider, a redirect to GitHub's authorize URL with one
 * (docs/decision/0034).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

type Boot = {
  meStatus: number;
  login: { github: boolean };
  principalKind: string;
  signUpStatus: number;
  socialStatus: number;
  clientId: string | null;
};

const PROBE = join(import.meta.dir, "../../testing/boot-probe.ts");
const PAIR = ["SPACES_GITHUB_CLIENT_ID", "SPACES_GITHUB_CLIENT_SECRET"] as const;

async function boot(env: Record<string, string> = {}): Promise<Boot> {
  const overrides = new Map(Object.entries(env));

  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => value !== undefined && !(PAIR as readonly string[]).includes(name),
    ),
  );

  for (const name of PAIR) {
    const value = overrides.get(name);

    if (value !== undefined) inherited[name] = value;
  }

  const child = Bun.spawn(["bun", "run", PROBE], {
    cwd: join(import.meta.dir, "../../.."),
    env: inherited,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;

  if (code !== 0) throw new Error(`boot probe failed (${code}): ${stderr}`);

  const line = stdout.trim().split("\n").at(-1) ?? "";

  return JSON.parse(line) as Boot;
}

describe("with no GitHub credentials", () => {
  test("the server boots, signs in by email, and reports no GitHub", async () => {
    const booted = await boot();
    expect(booted.meStatus).toBe(200);
    expect(booted.principalKind).toBe("operator");
    expect(booted.login).toEqual({ github: false });
    expect(booted.signUpStatus).toBe(200);
    expect(booted.clientId).toBeNull();
  });

  test("GitHub sign-in answers not found instead of redirecting", async () => {
    const booted = await boot();
    expect(booted.socialStatus).toBe(404);
  });

  test("half a pair is not a pair", async () => {
    const idOnly = await boot({ SPACES_GITHUB_CLIENT_ID: "Ov23li-example" });
    expect(idOnly.login).toEqual({ github: false });
    expect(idOnly.socialStatus).toBe(404);

    const secretOnly = await boot({ SPACES_GITHUB_CLIENT_SECRET: "example-secret" });
    expect(secretOnly.login).toEqual({ github: false });
    expect(secretOnly.socialStatus).toBe(404);
  });

  test("blank values are unset values", async () => {
    const blank = await boot({ SPACES_GITHUB_CLIENT_ID: " ", SPACES_GITHUB_CLIENT_SECRET: "" });
    expect(blank.login).toEqual({ github: false });
    expect(blank.clientId).toBeNull();
  });
});

describe("with both GitHub credentials", () => {
  const set = {
    SPACES_GITHUB_CLIENT_ID: "Ov23li-example",
    SPACES_GITHUB_CLIENT_SECRET: "example-secret",
  };

  test("the provider is registered and /me reports it available", async () => {
    const booted = await boot(set);
    expect(booted.login).toEqual({ github: true });
    expect(booted.clientId).toBe("Ov23li-example");
  });

  test("email + password still works alongside it", async () => {
    const booted = await boot(set);
    expect(booted.signUpStatus).toBe(200);
    expect(booted.meStatus).toBe(200);
  });

  test("GitHub sign-in gets past the provider lookup", async () => {
    const booted = await boot(set);
    expect(booted.socialStatus).not.toBe(404);
  });
});
