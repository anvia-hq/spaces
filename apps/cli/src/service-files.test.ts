import { describe, expect, test } from "bun:test";
import { launchdPlist, systemdUnit } from "./service-files.ts";

const definition = {
  label: "dev.anvia.spaces-runtime",
  command: ["/home/u/.bun/bin/bun", "/home/u/.spaces/src/apps/cli/src/main.ts", "runtime", "run"],
  env: { HOME: "/home/u", PATH: "/a:/b" },
  logFile: "/home/u/.spaces/logs/runtime.log",
  workingDirectory: "/home/u/.spaces",
};

describe("systemd unit", () => {
  const unit = systemdUnit(definition);

  test("runs the command, restarts it, and does not kill sandboxes with it", () => {
    expect(unit).toContain(
      'ExecStart="/home/u/.bun/bin/bun" "/home/u/.spaces/src/apps/cli/src/main.ts" "runtime" "run"',
    );
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("KillMode=process");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("logs to one file, so `spaces runtime logs` reads the same on every platform", () => {
    expect(unit).toContain("StandardOutput=append:/home/u/.spaces/logs/runtime.log");
    expect(unit).toContain("StandardError=append:/home/u/.spaces/logs/runtime.log");
  });

  test("environment is quoted, and a percent sign is not read as a specifier", () => {
    expect(unit).toContain('Environment="HOME=/home/u"');

    const odd = systemdUnit({ ...definition, env: { TOKEN: 'a"b%c\\d' }, command: ["/x y/bun"] });

    expect(odd).toContain('Environment="TOKEN=a\\"b%%c\\\\d"');
    expect(odd).toContain('ExecStart="/x y/bun"');
  });
});

describe("launchd plist", () => {
  const plist = launchdPlist(definition);

  test("keeps the agent alive and lets sandboxes outlive a restart", () => {
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>AbandonProcessGroup</key>\n  <true/>");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  test("lists the command one argument at a time", () => {
    expect(plist).toContain("<string>/home/u/.bun/bin/bun</string>");
    expect(plist).toContain("<string>runtime</string>\n    <string>run</string>");
  });

  test("XML in a value is escaped, not interpreted", () => {
    const odd = launchdPlist({ ...definition, env: { X: "a<b>&c" } });

    expect(odd).toContain("<string>a&lt;b&gt;&amp;c</string>");
    expect(odd).not.toContain("a<b>");
  });
});
