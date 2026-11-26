const port = Number(process.env.PORT ?? 8787);

const authUrl =
  process.env.SPACES_AUTH_URL ?? process.env.SPACES_PUBLIC_URL ?? `http://localhost:${port}`;

const githubClientId = process.env.SPACES_GITHUB_CLIENT_ID?.trim() ?? "";
const githubClientSecret = process.env.SPACES_GITHUB_CLIENT_SECRET?.trim() ?? "";

const extraOrigins = (
  process.env.SPACES_AUTH_TRUSTED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .flatMap((origin) => (origin.trim() ? [origin.trim()] : []));

export const config = {
  port,
  driver: (process.env.SPACES_DRIVER ?? "microsandbox") as "microsandbox" | "mock",

  runtime: {
    local: (process.env.SPACES_LOCAL_RUNTIME ?? "on") !== "off",
    controlUrl: process.env.SPACES_CONTROL_URL ?? "",
    token: process.env.SPACES_RUNTIME_TOKEN ?? "",
    publicHost: process.env.SPACES_RUNTIME_PUBLIC_HOST ?? "",
    offlineSweepMs: Number(process.env.SPACES_RUNTIME_SWEEP_MS ?? 5_000),
    vcpu: Number(process.env.SPACES_RUNTIME_VCPU ?? 0),
    memMib: Number(process.env.SPACES_RUNTIME_MEM_MIB ?? 0),
    reserveMib: Number(process.env.SPACES_RUNTIME_RESERVE_MIB ?? 1024),
    overcommit: Number(process.env.SPACES_RUNTIME_OVERCOMMIT ?? 1),
  },

  msbHost: process.env.SPACES_MSB_HOST ?? "local",
  msbPath: process.env.SPACES_MSB ?? "~/.local/bin/msb",
  msbImage: process.env.SPACES_MSB_IMAGE ?? "alpine",

  netProfile: process.env.SPACES_NET ?? "public",
  netRules: (process.env.SPACES_NET_RULES ?? "")
    .split(",")
    .flatMap((rule) => (rule.trim() ? [rule.trim()] : [])),
  netDefaultEgress: process.env.SPACES_NET_DEFAULT_EGRESS ?? "",
  netDefaultIngress: process.env.SPACES_NET_DEFAULT_INGRESS ?? "",
  netDns: process.env.SPACES_NET_DNS ?? "",

  portRange: {
    start: Number(process.env.SPACES_PORT_RANGE_START ?? 22000),
    end: Number(process.env.SPACES_PORT_RANGE_END ?? 22999),
  },
  bootstrap: process.env.SPACES_BOOTSTRAP ?? "",
  bootstrapTimeoutSeconds: Number(process.env.SPACES_BOOTSTRAP_TIMEOUT ?? 300),

  prepublishPorts: (
    process.env.SPACES_PREPUBLISH_PORTS ?? "3000,3001,4000,5000,5173,8000,8080,8888"
  )
    .split(",")
    .flatMap((port) => {
      const value = Number(port.trim());
      return Number.isInteger(value) && value > 0 && value <= 65535 ? [value] : [];
    }),

  portBind: process.env.SPACES_PORT_BIND ?? "127.0.0.1",
  previewHost: process.env.SPACES_PREVIEW_HOST ?? "",

  bindHost: process.env.SPACES_BIND ?? "0.0.0.0",
  webRoot: process.env.SPACES_WEB_ROOT ?? "",

  apiKey: process.env.SPACES_API_KEY ?? "sk_local_dev",
  adminEmails: (process.env.SPACES_ADMIN_EMAILS ?? "")
    .split(",")
    .flatMap((email) => (email.trim() ? [email.trim().toLowerCase()] : [])),
  auth: {
    secret: process.env.SPACES_AUTH_SECRET ?? "spaces-dev-auth-secret-change-me-0123456789",
    url: authUrl,
    trustedOrigins: [...new Set([authUrl, ...extraOrigins])],
    sessionDays: Number(process.env.SPACES_AUTH_SESSION_DAYS ?? 30),
    keyPrefix: process.env.SPACES_API_KEY_PREFIX ?? "spk_",
    github: {
      enabled: githubClientId !== "" && githubClientSecret !== "",
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    },
    debugLogging: process.env.SPACES_AUTH_DEBUG === "1",
  },
  signingKey:
    process.env.SPACES_SIGNING_KEY ?? `transfer:${process.env.SPACES_API_KEY ?? "sk_local_dev"}`,
  publicUrl: process.env.SPACES_PUBLIC_URL ?? "",
  traces: {
    enabled: (process.env.SPACES_TRACES ?? "on") !== "off",
    sampleRate: Number(process.env.SPACES_TRACE_SAMPLE_RATE ?? 1),
    retentionDays: Number(process.env.SPACES_TRACE_RETENTION_DAYS ?? 7),
    otlpEndpoint: process.env.SPACES_OTLP_ENDPOINT ?? "",
  },
  transferMaxBytes: Number(process.env.SPACES_TRANSFER_MAX ?? 100 * 1024 * 1024),
  databaseUrl: process.env.SPACES_DATABASE_URL ?? "postgres://localhost:5432/spaces",
  limits: {
    maxSandboxes: Number(process.env.SPACES_MAX_SANDBOXES ?? 32),
    maxSnapshots: Number(process.env.SPACES_MAX_SNAPSHOTS ?? 64),
    maxTtlSeconds: 2_592_000,
  },
  reaperIntervalMs: Number(process.env.SPACES_REAPER_MS ?? 15_000),
  samples: {
    intervalMs: Number(process.env.SPACES_SAMPLE_INTERVAL_MS ?? 30_000),
    retentionDays: Number(process.env.SPACES_SAMPLE_RETENTION_DAYS ?? 7),
  },
} as const;

export type Config = typeof config;
