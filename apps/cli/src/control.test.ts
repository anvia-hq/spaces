import { afterAll, describe, expect, test } from "bun:test";
import { TOKEN_PATTERN, checkToken, controlHealth, normalizeUrl } from "./control.ts";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/health") return new Response("{}", { status: 200 });

    if (path === "/runtime/connect") {
      const ok = request.headers.get("authorization") === "Bearer spr_good";

      return new Response("upgrade required", { status: ok ? 426 : 401 });
    }

    return new Response("no", { status: 404 });
  },
});
const url = `http://127.0.0.1:${server.port}`;

afterAll(() => server.stop(true));

describe("the control plane checks", () => {
  test("health is true only for a 200", async () => {
    expect(await controlHealth(url)).toBe(true);
    expect(await controlHealth(`${url}/nope`)).toBe(false);
  });

  test("an unreachable control plane is false, not an exception", async () => {
    expect(await controlHealth("http://127.0.0.1:1")).toBe(false);
  });

  test("a token the control plane knows is accepted; one it rejects is not", async () => {
    expect((await checkToken(url, "spr_good")).ok).toBe(true);

    const bad = await checkToken(url, "spr_bad");

    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("rejected that token");
  });

  test("a network failure is a failed check with the reason", async () => {
    const result = await checkToken("http://127.0.0.1:1", "spr_good");

    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("addresses and tokens", () => {
  test("trailing slashes go, a scheme is required", () => {
    expect(normalizeUrl("https://spaces.example.com///")).toBe("https://spaces.example.com");
    expect(normalizeUrl("  http://localhost:8787/ ")).toBe("http://localhost:8787");
    expect(() => normalizeUrl("spaces.example.com")).toThrow("http://");
    expect(() => normalizeUrl("ftp://x")).toThrow("http://");
  });

  test("a runtime token is spr_ and 48 hex characters", () => {
    expect(TOKEN_PATTERN.test(`spr_${"0123456789abcdef".repeat(3)}`)).toBe(true);
    expect(TOKEN_PATTERN.test("spr_short")).toBe(false);
    expect(TOKEN_PATTERN.test(`avrt_${"a".repeat(48)}`)).toBe(false);
    expect(TOKEN_PATTERN.test(`spr_${"A".repeat(48)}`)).toBe(false);
  });
});
