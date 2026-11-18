import type { ServiceDefinition } from "./types.ts";

function systemdQuote(word: string): string {
  const escaped = word.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");

  return `"${escaped}"`;
}

function xml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function systemdUnit(definition: ServiceDefinition): string {
  const environment = Object.entries(definition.env).map(
    ([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`,
  );

  return [
    "[Unit]",
    "Description=spaces runtime: runs sandboxes for a spaces control plane",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdQuote(definition.workingDirectory)}`,
    `ExecStart=${definition.command.map(systemdQuote).join(" ")}`,
    ...environment,
    "Restart=always",
    "RestartSec=2",
    "TimeoutStopSec=10",
    "KillMode=process",
    `StandardOutput=append:${definition.logFile}`,
    `StandardError=append:${definition.logFile}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function launchdPlist(definition: ServiceDefinition): string {
  const args = definition.command.map((word) => `    <string>${xml(word)}</string>`).join("\n");
  const env = Object.entries(definition.env)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(definition.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(definition.workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(definition.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(definition.logFile)}</string>
</dict>
</plist>
`;
}
