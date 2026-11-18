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

/** Runtime configuration. Everything has a working default for local dev. */
export const config = {
  port,
  /**
   * `microsandbox` runs real microVMs via `msb`.
   * `mock` is an in-process fixture for tests and machines without a hypervisor.
   */
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

  /**
   * Where `msb` runs. `local` means this machine; anything else is an SSH host.
   * microsandbox is cross-platform (KVM / Hypervisor.framework / WHP), so local
   * is the common case and removes a network hop from every call.
   */
  msbHost: process.env.SPACES_MSB_HOST ?? "local",
  /** `msb` binary path. `~` expands on both local and remote transports. */
  msbPath: process.env.SPACES_MSB ?? "~/.local/bin/msb",
  /** OCI image used for new sandboxes. */
  msbImage: process.env.SPACES_MSB_IMAGE ?? "alpine",

  /**
   * Guest networking, off by one value and off by default for the whole family.
   *
   * `public` gives egress with gateway DNS (the usual case: package installs,
   * API calls). `private` restricts to private address space, `host` to the
   * host, `all` lifts filtering entirely, and `none` (or setting
   * `SPACES_NET=none`) leaves the guest with no network at all.
   */
  netProfile: process.env.SPACES_NET ?? "public",
  /**
   * Extra `msb --net-rule` entries, comma separated, e.g.
   * `allow@example.com:tcp:443,deny@198.51.100.5`. Rules take precedence over
   * the profile's default.
   */
  netRules: (process.env.SPACES_NET_RULES ?? "")
    .split(",")
    .flatMap((rule) => (rule.trim() ? [rule.trim()] : [])),
  /** Default action for unmatched egress/ingress; empty keeps msb's default. */
  netDefaultEgress: process.env.SPACES_NET_DEFAULT_EGRESS ?? "",
  netDefaultIngress: process.env.SPACES_NET_DEFAULT_INGRESS ?? "",
  /** Nameserver to forward guest DNS to; empty uses the host's resolv.conf. */
  netDns: process.env.SPACES_NET_DNS ?? "",

  /**
   * Host-side port range used by `POST /sandboxes/{id}/host`.
   * 0 disables port publishing entirely.
   */
  portRange: {
    start: Number(process.env.SPACES_PORT_RANGE_START ?? 22000),
    end: Number(process.env.SPACES_PORT_RANGE_END ?? 22999),
  },
  /**
   * Shell snippet run once after a sandbox boots, before it is marked ready.
   *
   * The stock OCI image has no sshd and no Docker; boat's Ubuntu machine has
   * both. Set this to converge a fresh sandbox towards that, e.g.
   * `apk add --no-cache openssh docker docker-cli` plus starting dockerd.
   * Failures are logged and never block the sandbox from becoming ready.
   */
  bootstrap: process.env.SPACES_BOOTSTRAP ?? "",
  /** Seconds the bootstrap snippet may take. */
  bootstrapTimeoutSeconds: Number(process.env.SPACES_BOOTSTRAP_TIMEOUT ?? 300),

  /**
   * Guest ports published when the sandbox is created, so `POST /host` on a
   * common dev-server port is instant instead of needing a microVM restart.
   * Empty disables pre-publishing; every port then costs one restart.
   */
  prepublishPorts: (
    process.env.SPACES_PREPUBLISH_PORTS ?? "3000,3001,4000,5000,5173,8000,8080,8888"
  )
    .split(",")
    .flatMap((port) => {
      const value = Number(port.trim());
      return Number.isInteger(value) && value > 0 && value <= 65535 ? [value] : [];
    }),

  /**
   * Address a published port binds to on the host. Loopback by default: the
   * API proxies traffic, so nothing else needs to reach the port directly.
   */
  portBind: process.env.SPACES_PORT_BIND ?? "127.0.0.1",
  /**
   * Host used when building a preview URL. Empty means the API's own origin,
   * which is the usual case because the API proxies the request.
   */
  previewHost: process.env.SPACES_PREVIEW_HOST ?? "",

  /**
   * Interface to bind. `0.0.0.0` is the default; set a specific address (a
   * Tailscale IP, or `127.0.0.1` behind a reverse proxy) to narrow exposure.
   */
  bindHost: process.env.SPACES_BIND ?? "0.0.0.0",
  /**
   * Directory holding the built console (`apps/web/dist`). Empty disables static
   * serving, which is what development wants because Vite serves it.
   *
   * Serving the console from the API removes the most common deployment
   * mistake: a proxy that forwards `/api` but not `/health`, which makes the
   * console report the API unreachable while it is answering normally.
   */
  webRoot: process.env.SPACES_WEB_ROOT ?? "",

  /**
   * The operator's bearer key. An empty value turns it off, leaving only
   * Better Auth sessions and user API keys (see docs/decision/0028).
   */
  apiKey: process.env.SPACES_API_KEY ?? "sk_local_dev",
  /**
   * Addresses that become admins the first time they sign in. This is the
   * bootstrap, not the membership list: once one admin exists they promote the
   * rest through the API, and this can be emptied (docs/decision/0036).
   */
  adminEmails: (process.env.SPACES_ADMIN_EMAILS ?? "")
    .split(",")
    .flatMap((email) => (email.trim() ? [email.trim().toLowerCase()] : [])),
  auth: {
    /** Signing secret for sessions and keys; must change in production. */
    secret: process.env.SPACES_AUTH_SECRET ?? "spaces-dev-auth-secret-change-me-0123456789",
    /** Public origin of the API, used for cookies and links. */
    url: authUrl,
    /**
     * Origins allowed to post to `/api/auth`. The API's own origin is always
     * trusted; the console's dev origin is the default extra.
     */
    trustedOrigins: [...new Set([authUrl, ...extraOrigins])],
    /** How long a console session lasts. */
    sessionDays: Number(process.env.SPACES_AUTH_SESSION_DAYS ?? 30),
    /** Prefix on generated API keys, so they are recognisable in logs and files. */
    keyPrefix: process.env.SPACES_API_KEY_PREFIX ?? "spk_",
    /**
     * GitHub OAuth. Registered only when both halves are set: half a pair
     * cannot complete a sign-in, and the console hides the button on the same
     * signal (docs/decision/0036).
     */
    github: {
      enabled: githubClientId !== "" && githubClientSecret !== "",
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    },
    /** `SPACES_AUTH_DEBUG=1` prints Better Auth's own reasoning to the log. */
    debugLogging: process.env.SPACES_AUTH_DEBUG === "1",
  },
  /**
   * HMAC key for signed transfer URLs. Derived from the API key when unset, so
   * rotating the key invalidates outstanding links.
   */
  signingKey:
    process.env.SPACES_SIGNING_KEY ?? `transfer:${process.env.SPACES_API_KEY ?? "sk_local_dev"}`,
  /** Public origin used when minting transfer URLs; derived from the request when unset. */
  publicUrl: process.env.SPACES_PUBLIC_URL ?? "",
  traces: {
    /** Set to "off" to record nothing (the API still answers, spans are dropped). */
    enabled: (process.env.SPACES_TRACES ?? "on") !== "off",
    /** Fraction of requests traced; 1 traces everything. */
    sampleRate: Number(process.env.SPACES_TRACE_SAMPLE_RATE ?? 1),
    /** Spans older than this are swept by the reaper. 0 disables the sweep. */
    retentionDays: Number(process.env.SPACES_TRACE_RETENTION_DAYS ?? 7),
    /** Optional collector. When empty, spans only live in this database. */
    otlpEndpoint: process.env.SPACES_OTLP_ENDPOINT ?? "",
  },
  /** Ceiling for a single signed transfer (buffered in memory). */
  transferMaxBytes: Number(process.env.SPACES_TRANSFER_MAX ?? 100 * 1024 * 1024),
  /** Postgres connection string. SPACES_DB (SQLite) is gone — decision 0030. */
  databaseUrl: process.env.SPACES_DATABASE_URL ?? "postgres://localhost:5432/spaces",
  limits: {
    maxSandboxes: Number(process.env.SPACES_MAX_SANDBOXES ?? 32),
    maxSnapshots: Number(process.env.SPACES_MAX_SNAPSHOTS ?? 64),
    maxTtlSeconds: 2_592_000,
  },
  /** Auto-stop sweep interval. */
  reaperIntervalMs: Number(process.env.SPACES_REAPER_MS ?? 15_000),
} as const;

export type Config = typeof config;
