import { config } from "./config.ts";
import { buildDriver } from "./modules/driver/service.ts";
import { detectResources } from "./modules/driver/resources.ts";
import { isLocalHost } from "./modules/driver/ssh.ts";
import { startAgent } from "./modules/runtime-agent/agent.ts";

const AGENT_VERSION = "0.1.0";

if (!config.runtime.controlUrl || !config.runtime.token) {
  console.error("[agent] set SPACES_CONTROL_URL and SPACES_RUNTIME_TOKEN");
  process.exit(1);
}

const driver = buildDriver();
const portsOn = config.portRange.start > 0 && config.portRange.end >= config.portRange.start;

const agent = startAgent({
  url: config.runtime.controlUrl,
  token: config.runtime.token,
  driver,
  version: AGENT_VERSION,
  resources: detectResources(driver.kind, isLocalHost(config.msbHost)),
  portRange: portsOn ? { start: config.portRange.start, end: config.portRange.end } : null,
  portBind: config.portBind,
  publicHost: config.runtime.publicHost || null,
  log: (message) => console.log(`[agent] ${message}`),
});

console.log(
  `[agent] driver=${driver.kind} capabilities=${JSON.stringify(driver.capabilities)} control=${config.runtime.controlUrl}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void agent.stop().then(() => process.exit(0));
  });
}
