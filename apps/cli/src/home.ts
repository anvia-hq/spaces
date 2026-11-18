import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export const spacesHome = (env: Env = process.env) => env.SPACES_HOME || join(homedir(), ".spaces");

export const sourceDir = (home = spacesHome()) => join(home, "src");

export const runtimeEnvFile = (home = spacesHome()) => join(home, "runtime.env");

export const logsDir = (home = spacesHome()) => join(home, "logs");

export const runtimeLogFile = (home = spacesHome()) => join(logsDir(home), "runtime.log");

export const refFile = (home = spacesHome()) => join(sourceDir(home), ".spaces-ref");

export const agentEntry = (home = spacesHome()) =>
  join(sourceDir(home), "apps", "api", "src", "agent.ts");

export const installScript = (home = spacesHome()) => join(sourceDir(home), "install.sh");
