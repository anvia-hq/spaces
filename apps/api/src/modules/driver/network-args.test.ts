/**
 * Deterministic tests for the networking policy mapping.
 *
 * Item 7 of the conformance pass is "document that `public` denies private
 * addresses and show how to allow one". Documentation that is not tied to code
 * rots, so the mapping itself is tested here: profile -> flags.
 */
import { describe, expect, test } from "bun:test";
import { networkArgsFor, restoreNetworkArgsFor, rootDiskArgsFor } from "./microsandbox.ts";

const base = {
  profile: "public",
  rules: [] as string[],
  defaultEgress: "",
  defaultIngress: "",
  dns: "",
};

describe("SPACES_NET -> msb flags", () => {
  test("default public: a profile, not a free pass", () => {
    // `public` is a profile: public addresses reachable, private denied. That is
    // why a guest cannot reach a LAN or tailnet address until it is allowed.
    expect(networkArgsFor(base)).toEqual(["--net", "public"]);
  });

  test("all is passed through as a terminal policy", () => {
    expect(networkArgsFor({ ...base, profile: "all" })).toEqual(["--net", "all"]);
  });

  test("none means no network device at all", () => {
    expect(networkArgsFor({ ...base, profile: "none" })).toEqual(["--no-net"]);
    expect(networkArgsFor({ ...base, profile: "   " })).toEqual(["--no-net"]);
  });

  test("a single allowed host is an explicit rule", () => {
    const args = networkArgsFor({ ...base, rules: ["allow@192.168.1.50"] });
    expect(args).toEqual(["--net", "public", "--net-rule", "allow@192.168.1.50"]);
  });

  test("rules are passed in order, one flag each", () => {
    const args = networkArgsFor({
      ...base,
      rules: ["allow@192.168.1.50", "allow@100.101.102.103:tcp:5432"],
    });
    expect(args).toEqual([
      "--net",
      "public",
      "--net-rule",
      "allow@192.168.1.50",
      "--net-rule",
      "allow@100.101.102.103:tcp:5432",
    ]);
  });

  test("blank settings are omitted rather than passed as empty flags", () => {
    const args = networkArgsFor({ ...base, defaultEgress: "deny", dns: "1.1.1.1" });
    expect(args).toEqual([
      "--net",
      "public",
      "--net-default-egress",
      "deny",
      "--dns-nameserver",
      "1.1.1.1",
    ]);
    expect(args).not.toContain("--net-default-ingress");
  });
});

describe("per-sandbox network policy -> msb flags", () => {
  test("default policy delegates to runtime environment", () => {
    expect(
      networkArgsFor({
        ...base,
        rules: ["allow@192.168.1.50"],
        policy: { mode: "default", allow: [] },
      }),
    ).toEqual(["--net", "public", "--net-rule", "allow@192.168.1.50"]);
  });

  test("deny air-gaps the sandbox with --no-net", () => {
    expect(networkArgsFor({ ...base, policy: { mode: "deny", allow: [] } })).toEqual(["--no-net"]);
    expect(restoreNetworkArgsFor({ mode: "deny", allow: [] })).toEqual(["--no-net"]);
  });

  test("open forces public profile without private LAN rules", () => {
    expect(
      networkArgsFor({
        ...base,
        profile: "all",
        rules: ["allow@192.168.1.50"],
        dns: "1.1.1.1",
        policy: { mode: "open", allow: [] },
      }),
    ).toEqual(["--net", "public", "--dns-nameserver", "1.1.1.1"]);

    expect(restoreNetworkArgsFor({ mode: "open", allow: [] })).toEqual([
      "--net-default",
      "deny",
      "--net-rule",
      "allow@public",
      "--net-rule",
      "allow@dns",
    ]);
  });

  test("allow builds --no-net + allow@dns + port 443/80 for domains and raw allow for public IPs", () => {
    expect(
      networkArgsFor({
        ...base,
        dns: "1.1.1.1",
        policy: { mode: "allow", allow: ["github.com", "*.npmjs.org", "1.1.1.1"] },
      }),
    ).toEqual([
      "--no-net",
      "--net-rule",
      "allow@dns",
      "--dns-nameserver",
      "1.1.1.1",
      "--net-rule",
      "allow@github.com:tcp:443",
      "--net-rule",
      "allow@github.com:tcp:80",
      "--net-rule",
      "allow@*.npmjs.org:tcp:443",
      "--net-rule",
      "allow@*.npmjs.org:tcp:80",
      "--net-rule",
      "allow@1.1.1.1",
    ]);

    expect(
      networkArgsFor({
        ...base,
        policy: { mode: "allow", allow: ["1.1.1.1"] },
      }),
    ).toEqual(["--no-net", "--net-rule", "allow@1.1.1.1"]);
  });
});

describe("machine size -> root disk flags", () => {
  test("the root disk is the size's disk, not msb's 4 GiB default", () => {
    expect(rootDiskArgsFor({ vcpu: 4, memMib: 8192, diskGb: 51 })).toEqual(["--root-disk", "51G"]);
  });
});
