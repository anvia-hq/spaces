export interface Args {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export interface RuntimeSettings {
  url: string;
  token: string;
  publicHost: string | undefined;
  image: string | undefined;
  msb: string;
  extra: Record<string, string>;
}

export interface ServiceDefinition {
  label: string;
  command: string[];
  env: Record<string, string>;
  logFile: string;
  workingDirectory: string;
}

export interface ServiceManager {
  install(definition: ServiceDefinition): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<string>;
}

export interface ServiceNames {
  launchdLabel: string;
  systemdUnit: string;
}

export interface ExecResult {
  code: number;
  out: string;
}

export interface TokenCheck {
  ok: boolean;
  message: string;
}

export interface InstallDeps {
  env: Record<string, string | undefined>;
  home: string;
  bun: string;
  entry: string;
  locateMsb(): Promise<string | undefined>;
  doctor(msb: string): Promise<ExecResult>;
  controlHealth(url: string): Promise<boolean>;
  checkToken(url: string, token: string): Promise<TokenCheck>;
  manager: ServiceManager;
  waitForConnection(logFile: string, from: number): Promise<string | undefined>;
  print(line: string): void;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
