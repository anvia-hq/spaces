import { describe, expect, test } from "bun:test";
import { classifyNetworkEntry, isPrivateIpOrCidr } from "@spaces/shared/sandbox";
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
  test("default policy delegates to runtime environment on create and restore", () => {
    expect(
      networkArgsFor({
        ...base,
        rules: ["allow@192.168.1.50"],
        policy: { mode: "default", allow: [] },
      }),
    ).toEqual(["--net", "public", "--net-rule", "allow@192.168.1.50"]);

    expect(
      restoreNetworkArgsFor({
        profile: "public",
        rules: ["allow@192.168.1.50"],
        defaultEgress: "",
        policy: { mode: "default", allow: [] },
      }),
    ).toEqual([
      "--net-default",
      "deny",
      "--net-rule",
      "allow:ingress@private",
      "--net-rule",
      "allow:ingress@public",
      "--net-rule",
      "allow@public",
      "--net-rule",
      "allow@dns",
      "--net-rule",
      "allow@192.168.1.50",
    ]);

    expect(
      restoreNetworkArgsFor({
        profile: "none",
        rules: [],
        defaultEgress: "",
      }),
    ).toEqual(["--no-net"]);

    expect(
      restoreNetworkArgsFor({
        profile: "all",
        rules: [],
        defaultEgress: "",
      }),
    ).toEqual(["--net-default", "allow"]);
  });

  test("deny air-gaps the sandbox with --no-net", () => {
    expect(networkArgsFor({ ...base, policy: { mode: "deny", allow: [] } })).toEqual(["--no-net"]);
    expect(
      restoreNetworkArgsFor({
        profile: "public",
        rules: [],
        defaultEgress: "",
        policy: { mode: "deny", allow: [] },
      }),
    ).toEqual(["--no-net"]);
  });

  test("open forces public profile without private LAN rules and keeps ingress open on restore", () => {
    expect(
      networkArgsFor({
        ...base,
        profile: "all",
        rules: ["allow@192.168.1.50"],
        dns: "1.1.1.1",
        policy: { mode: "open", allow: [] },
      }),
    ).toEqual(["--net", "public", "--dns-nameserver", "1.1.1.1"]);

    expect(
      restoreNetworkArgsFor({
        profile: "all",
        rules: ["allow@192.168.1.50"],
        defaultEgress: "",
        policy: { mode: "open", allow: [] },
      }),
    ).toEqual([
      "--net-default",
      "deny",
      "--net-rule",
      "allow:ingress@private",
      "--net-rule",
      "allow:ingress@public",
      "--net-rule",
      "allow@public",
      "--net-rule",
      "allow@dns",
    ]);
  });

  test("allow denies egress while preserving ingress, brackets IPv6, and rejects private IPs", () => {
    expect(
      networkArgsFor({
        ...base,
        dns: "1.1.1.1",
        policy: {
          mode: "allow",
          allow: ["github.com", "*.npmjs.org", "1.1.1.1", "2606:4700:4700::1111", "2606:4700::/32"],
        },
      }),
    ).toEqual([
      "--net-default-egress",
      "deny",
      "--net-default-ingress",
      "allow",
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
      "--net-rule",
      "allow@[2606:4700:4700::1111]",
      "--net-rule",
      "allow@[2606:4700::/32]",
    ]);

    expect(
      networkArgsFor({
        ...base,
        policy: { mode: "allow", allow: ["1.1.1.1"] },
      }),
    ).toEqual([
      "--net-default-egress",
      "deny",
      "--net-default-ingress",
      "allow",
      "--net-rule",
      "allow@1.1.1.1",
    ]);

    expect(
      restoreNetworkArgsFor({
        profile: "public",
        rules: [],
        defaultEgress: "",
        policy: { mode: "allow", allow: ["github.com", "2606:4700:4700::1111"] },
      }),
    ).toEqual([
      "--net-default",
      "deny",
      "--net-rule",
      "allow:ingress@private",
      "--net-rule",
      "allow:ingress@public",
      "--net-rule",
      "allow@dns",
      "--net-rule",
      "allow@github.com:tcp:443",
      "--net-rule",
      "allow@github.com:tcp:80",
      "--net-rule",
      "allow@[2606:4700:4700::1111]",
    ]);

    expect(() =>
      networkArgsFor({ ...base, policy: { mode: "allow", allow: ["127.0.0.1"] } }),
    ).toThrow("private or reserved IP/CIDR");
  });
});

describe("shared network entry classification and private IP checks", () => {
  test("classifies domains, IPv4, and IPv6 strictly and rejects malformed inputs", () => {
    expect(classifyNetworkEntry("github.com")).toBe("domain");
    expect(classifyNetworkEntry("*.npmjs.org")).toBe("domain");
    expect(classifyNetworkEntry("1.1.1.1")).toBe("ip");
    expect(classifyNetworkEntry("2606:4700:4700::1111")).toBe("ip");
    expect(classifyNetworkEntry("2606:4700::/32")).toBe("ip");

    for (const bad of [
      "",
      "localhost",
      "github.com.",
      "*.com",
      "012.0.0.1",
      "1.1.1.1/08",
      ":",
      ":::",
      "1::2::3",
      "12345::1",
      "1:2:3:4:5:6:7:8:9",
      "2606:4700::/129",
    ]) {
      expect({ bad, kind: classifyNetworkEntry(bad) }).toEqual({ bad, kind: null });
    }
  });

  test("flags private, reserved, mapped, and overlapping supernet IPv4 and IPv6 ranges", () => {
    expect(isPrivateIpOrCidr("1.1.1.1")).toBe(false);
    expect(isPrivateIpOrCidr("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIpOrCidr("2606:4700::/32")).toBe(false);

    for (const priv of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "0.0.0.0/0",
      "::",
      "::1",
      "0::1",
      "0:0:0:0:0:0:0:1",
      "0:0:0:0:0:ffff:7f00:1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "fc00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "100::1",
      "8000::/1",
      "0::/1",
      "f000::/4",
      "fe00::/8",
      "2001:db8::1",
      "2002::1",
    ]) {
      expect({ priv, blocked: isPrivateIpOrCidr(priv) }).toEqual({ priv, blocked: true });
    }
  });
});

describe("machine size -> root disk flags", () => {
  test("the root disk is the size's disk, not msb's 4 GiB default", () => {
    expect(rootDiskArgsFor({ vcpu: 4, memMib: 8192, diskGb: 51 })).toEqual(["--root-disk", "51G"]);
  });
});
