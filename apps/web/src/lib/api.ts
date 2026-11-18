import type { Runtime, RuntimeSample } from "@spaces/shared/runtime";
import type { MachineSize, Sandbox, SandboxState, SandboxType } from "@spaces/shared/sandbox";

const BASE = "/api/v1";
/*
 * Requests authenticate with the Better Auth session cookie, so there is no
 * bearer header here and nothing to store. The operator key is a server-side
 * credential for API clients; the console does not use it.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** The server refused the key that was sent. */
  get isUnauthorized() {
    return this.status === 401 || this.status === 403;
  }
  /** Errors the caller can act on rather than retry blindly. */
  get isConflict() {
    return this.status === 409;
  }
  get isMissing() {
    return this.status === 404;
  }
}

function headers(init?: HeadersInit): Headers {
  const h = new Headers(init);

  if (!h.has("content-type")) h.set("content-type", "application/json");

  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: headers(init.headers),
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body is still a valid failure; keep the text for the message.
    body = { message: text.slice(0, 300) };
  }

  if (!res.ok) {
    const envelope = body as { message?: string; code?: string };
    throw new ApiError(
      res.status,
      envelope.code ?? `http_${res.status}`,
      envelope.message ?? res.statusText,
    );
  }

  return body as T;
}

/* ------------------------------------------------------------------ sandboxes */

export interface SandboxEvent {
  id: number;
  type: string;
  at: string;
  payload?: Record<string, unknown>;
}

export interface CommandRecord {
  commandId: string;
  sandboxId: string;
  command: string;
  cwd: string | null;
  mode: "sync" | "stream" | "detached" | "process";
  processId: number | null;
  status: "running" | "exited" | "timed_out" | "failed" | "killed" | "lost";
  exitCode: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  user: string;
  memoryMB: number;
  command: string;
  commandId: string | null;
}

export interface SandboxUsage {
  sandboxId: string;
  sandboxType: SandboxType;
  billingMultiplier: number;
  since: string;
  until: string;
  seconds: number;
  dollars: number;
  secondsPerDollar: number;
  running: boolean;
}

export interface PublishedPort {
  port: number;
  hostPort: number;
  /** False for ports reserved at create time that nobody asked for yet. */
  explicit: boolean;
  title: string | null;
  access: "private" | "public";
  isProtected: boolean;
  localhost: boolean;
  createdAt: string;
}

export interface HostedPort {
  type: "port.hosted";
  port: number;
  url: string;
  isProtected: boolean;
  access: "private" | "public";
  restartRequired?: boolean;
  message?: string;
}

export interface SshKeyResult {
  type: "ssh_key.configured";
  machineIp: string | null;
  sshUser: string;
  sshEndpoint: string | null;
  hostKey: string;
  message?: string;
  note?: string;
}

export interface SavedSnapshot {
  name: string;
  status: "saving" | "ready" | "failed";
  error?: string;
  sourceSandboxId: string;
  snapshotId?: string;
  type?: SandboxType;
  sizeBytes?: number;
  createdAt: string;
}

export interface SnapshotShare {
  id: string;
  codePrefix: string;
  status: "active" | "revoked";
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface TreeEntry {
  path: string;
  kind: "file" | "dir" | "symlink";
  size?: number;
}

export interface SnapshotTree {
  snapshotId: string;
  sandboxId: string;
  generation: number;
  treeAvailable: boolean;
  truncated: boolean;
  fileCount: number;
  totalSizeBytes: number;
  entries: TreeEntry[];
}

export const api = {
  /** Health lives outside /api/v1 and needs no auth. */
  health: async () => {
    const res = await fetch("/health");

    if (!res.ok) throw new ApiError(res.status, "health_failed", res.statusText);

    // A dev server without a /health proxy answers with the SPA fallback, which
    // is a 200 full of HTML. Say so instead of failing on a JSON parse.

    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      throw new ApiError(
        502,
        "health_not_proxied",
        "/health did not return JSON — the web server is probably not proxying it to the API.",
      );
    }

    return (await res.json()) as {
      ok: true;
      driver: string;
      capabilities: { exec: boolean; files: boolean; persistence: boolean };
    };
  },

  limits: () =>
    request<{
      limits: {
        maxSandboxes: number;
        maxSnapshots: number;
        maxTtlSeconds: number;
        allowedTypes: string[];
      };
      usage: { sandboxes: number; running: number; snapshots: number };
    }>("/limits"),

  listSandboxes: () => request<{ sandboxes: Sandbox[] }>("/sandboxes"),

  getSandbox: (id: string) => request<{ sandbox: Sandbox }>(`/sandboxes/${id}`),

  createSandbox: (input: {
    type: SandboxType;
    ttlSeconds: number | null;
    name?: string;
    runtime?: string;
    labels?: Record<string, string>;
  }) =>
    request<{ sandbox: Sandbox }>("/sandboxes", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteSandbox: (id: string) => request<{ id: string }>(`/sandboxes/${id}`, { method: "DELETE" }),

  stopSandbox: (id: string) =>
    request<{ stop: { id: string; status: string } }>(`/sandboxes/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  resumeSandbox: (id: string) =>
    request<{ sandbox: Sandbox }>(`/sandboxes/${id}/resume`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  recoverSandbox: (id: string) =>
    request<{ ok: true; type: string; status: string; message: string }>(
      `/sandboxes/${id}/recover`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),

  forkSandbox: (id: string) =>
    request<{ sandbox: Sandbox }>(`/sandboxes/${id}/fork`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  events: (id: string) => request<{ events: SandboxEvent[] }>(`/sandboxes/${id}/events`),

  usage: (id: string, window?: { since?: string; until?: string }) => {
    const q = new URLSearchParams();

    if (window?.since) q.set("since", window.since);

    if (window?.until) q.set("until", window.until);

    const suffix = q.toString() ? `?${q}` : "";
    return request<SandboxUsage>(`/sandboxes/${id}/usage${suffix}`);
  },

  /* --------------------------------------------------------------- commands */

  runCommand: (id: string, command: string, opts?: { cwd?: string; timeoutSeconds?: number }) =>
    request<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      commandId: string;
      startedAt: string;
      finishedAt: string;
    }>(`/sandboxes/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command, ...opts }),
    }),

  /** Launch in the background; poll with `commandStatus` or attach to the stream. */
  startProcess: (id: string, command: string, opts?: { cwd?: string; timeoutSeconds?: number }) =>
    request<{
      type: "command.started";
      commandId: string;
      processId: number;
      pid: number;
      command: string;
      cwd: string;
      startedAt: string;
      logPath: string;
    }>(`/sandboxes/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command, detached: true, ...opts }),
    }),

  commandStatus: (
    id: string,
    processId: number,
    offsets?: { stdoutOffset?: number; stderrOffset?: number; tailBytes?: number },
  ) => {
    const q = new URLSearchParams();

    if (offsets?.stdoutOffset !== undefined) q.set("stdoutOffset", String(offsets.stdoutOffset));

    if (offsets?.stderrOffset !== undefined) q.set("stderrOffset", String(offsets.stderrOffset));

    if (offsets?.tailBytes !== undefined) q.set("tailBytes", String(offsets.tailBytes));

    const suffix = q.toString() ? `?${q}` : "";
    return request<{
      processId: number;
      status: "running" | "exited" | "lost";
      known: boolean;
      running: boolean;
      exitCode: number | null;
      command: string | null;
      stdout: string;
      stderr: string;
      stdoutNextOffset: number;
      stderrNextOffset: number;
      startedAt: string | null;
      finishedAt: string | null;
    }>(`/sandboxes/${id}/commands/${processId}${suffix}`);
  },

  killProcess: (id: string, processId: number) =>
    request<{
      processId: number;
      running: false;
      signaled: boolean;
      command: CommandRecord | null;
    }>(`/sandboxes/${id}/commands/${processId}`, { method: "DELETE" }),

  processes: (id: string) =>
    request<{ live: boolean; sampledAt: string | null; total: number; processes: ProcessInfo[] }>(
      `/sandboxes/${id}/processes`,
    ),

  commandHistory: (id: string) =>
    request<{ commands: CommandRecord[] }>(`/sandboxes/${id}/command-history`),

  commandLogs: (
    id: string,
    commandId: string,
    opts?: {
      stream?: "stdout" | "stderr";
      offset?: number;
      limit?: number;
      encoding?: "utf8" | "base64";
    },
  ) => {
    const q = new URLSearchParams();

    if (opts?.stream) q.set("stream", opts.stream);

    if (opts?.offset !== undefined) q.set("offset", String(opts.offset));

    if (opts?.limit !== undefined) q.set("limit", String(opts.limit));

    if (opts?.encoding) q.set("encoding", opts.encoding);

    const suffix = q.toString() ? `?${q}` : "";
    return request<{
      commandId: string;
      stream: "stdout" | "stderr";
      offset: number;
      nextOffset: number;
      size: number;
      encoding: "utf8" | "base64";
      data: string;
      done: boolean;
    }>(`/sandboxes/${id}/command-history/${commandId}/logs${suffix}`);
  },

  /* ------------------------------------------------------------ networking */

  /** Added to this server, not part of boat's contract: the ports it published. */
  publishedPorts: (id: string) => request<{ ports: PublishedPort[] }>(`/sandboxes/${id}/ports`),

  hostPort: (
    id: string,
    port: number,
    opts?: { public?: boolean; localhost?: boolean; title?: string },
  ) =>
    request<HostedPort>(`/sandboxes/${id}/host`, {
      method: "POST",
      body: JSON.stringify({ port, ...opts }),
    }),

  unhostPort: (id: string, port: number) =>
    request<{ port: number; status: string }>(`/sandboxes/${id}/host/${port}`, {
      method: "DELETE",
    }),

  sshKey: (id: string, key: string) =>
    request<SshKeyResult>(`/sandboxes/${id}/sshkey`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),

  /* ------------------------------------------------------------- snapshots */

  savedSnapshots: () =>
    request<{ snapshots: SavedSnapshot[]; allowance: Record<string, unknown> }>("/saved-snapshots"),

  saveSnapshot: (sandboxId: string, name: string) =>
    request<{ snapshot: SavedSnapshot }>("/saved-snapshots", {
      method: "POST",
      body: JSON.stringify({ sandboxId, name }),
    }),

  getSavedSnapshot: (name: string) =>
    request<{ snapshot: SavedSnapshot }>(`/saved-snapshots/${name}`),

  deleteSavedSnapshot: (name: string) =>
    request<{ name: string; status: "deleted" }>(`/saved-snapshots/${name}`, { method: "DELETE" }),

  snapshotShares: (name: string) =>
    request<{ name: string; shares: SnapshotShare[] }>(`/saved-snapshots/${name}/shares`),

  createShare: (name: string) =>
    request<{ name: string; shareCode: string; share: SnapshotShare }>(
      `/saved-snapshots/${name}/shares`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  revokeShare: (name: string, shareId: string) =>
    request<{ name: string; share: SnapshotShare }>(`/saved-snapshots/${name}/shares/${shareId}`, {
      method: "DELETE",
    }),

  snapshotTree: (snapshotId: string) =>
    request<SnapshotTree & { ok: true; type: string }>(`/snapshots/${snapshotId}/tree`),

  snapshotDownloadUrl: (snapshotId: string) =>
    request<{ chunks: { signedUrl: string; sizeBytes: number | null }[] }>(
      `/snapshots/${snapshotId}/download`,
    ),

  /** Direct URL for one path inside a snapshot (file bytes or a folder tar). */
  snapshotFileUrl: (snapshotId: string, path: string) =>
    `${BASE}/snapshots/${snapshotId}/files?path=${encodeURIComponent(path)}`,

  /* -------------------------------------------------------- machine sizes */

  /** Every preset this deployment offers, active ones only unless asked. */
  machineSizes: (options?: { includeRetired?: boolean }) =>
    request<{ sizes: MachineSize[] }>(
      `/machine-sizes${options?.includeRetired ? "?includeRetired=true" : ""}`,
    ),

  createMachineSize: (input: {
    name: string;
    vcpu: number;
    memMib: number;
    diskGb: number;
    description?: string | null;
  }) =>
    request<{ size: MachineSize }>("/machine-sizes", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateMachineSize: (
    name: string,
    patch: { vcpu?: number; memMib?: number; diskGb?: number; description?: string | null },
  ) =>
    request<{ size: MachineSize }>(`/machine-sizes/${name}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  retireMachineSize: (name: string) =>
    request<{ name: string; retiredAt: string; inUse: number }>(`/machine-sizes/${name}`, {
      method: "DELETE",
    }),

  /* ------------------------------------------------------------- identity */

  /**
   * Who this browser is: the operator key, a user session, or a user key; whether
   * it may act as the operator; and which alternative sign-in providers the
   * server has credentials for, so the auth screen never offers a button it
   * cannot honour.
   */
  me: () =>
    request<{
      principal: MePrincipal;
      operator: boolean;
      role: string;
      admin: boolean;
      login: LoginProviders;
    }>("/me"),

  /* ------------------------------------------------------------- api keys */

  listApiKeys: () => request<{ keys: ApiKeyEntry[] }>("/api-keys"),

  createApiKey: (name: string) =>
    request<{ key: string; entry: ApiKeyEntry }>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  revokeApiKey: (id: string) =>
    request<{ id: string; status: "revoked" }>(`/api-keys/${id}`, { method: "DELETE" }),

  /* -------------------------------------------------------------- runtimes */

  listRuntimes: () => request<{ runtimes: Runtime[] }>("/runtimes"),

  runtimeSamples: (minutes: number, runtime?: string) => {
    const query = new URLSearchParams({ minutes: String(minutes) });

    if (runtime) query.set("runtime", runtime);

    return request<{ samples: RuntimeSample[] }>(`/runtimes/samples?${query}`);
  },

  createRuntime: (input: { name: string; maxSandboxes?: number | null }) =>
    request<CreatedRuntime>("/runtimes", { method: "POST", body: JSON.stringify(input) }),

  updateRuntime: (
    runtime: string,
    patch: { name?: string; maxSandboxes?: number | null; draining?: boolean },
  ) =>
    request<{ runtime: Runtime }>(`/runtimes/${encodeURIComponent(runtime)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  rotateRuntimeToken: (runtime: string) =>
    request<CreatedRuntime>(`/runtimes/${encodeURIComponent(runtime)}/token`, { method: "POST" }),

  deleteRuntime: (runtime: string) =>
    request<{ id: string; name: string }>(`/runtimes/${encodeURIComponent(runtime)}`, {
      method: "DELETE",
    }),

  /* --------------------------------------------------------------- members */

  listUsers: (query: { search?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }

    const suffix = params.toString() ? `?${params}` : "";
    return request<{ users: ManagedUser[]; total: number; limit: number; offset: number }>(
      `/users${suffix}`,
    );
  },

  setUserRole: (userId: string, role: "admin" | "user") =>
    request<{ user: ManagedUser }>(`/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),

  banUser: (userId: string, reason: string | null) =>
    request<{ user: ManagedUser }>(`/users/${userId}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  unbanUser: (userId: string) =>
    request<{ user: ManagedUser }>(`/users/${userId}/ban`, { method: "DELETE" }),

  /* --------------------------------------------------------------- audit */

  auditLog: (query: AuditQuery) => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }

    const suffix = params.toString() ? `?${params}` : "";
    return request<{ entries: AuditEntry[]; nextCursor: string | null }>(`/audit-log${suffix}`);
  },

  auditActions: () => request<{ actions: string[] }>("/audit-log/actions"),

  /* -------------------------------------------------------------- traces */

  traces: (query: TraceQuery) => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }

    const suffix = params.toString() ? `?${params}` : "";
    return request<{ traces: TraceSummary[] }>(`/traces${suffix}`);
  },

  traceMetrics: (windowMinutes = 60) =>
    request<TraceMetrics>(`/traces/metrics?windowMinutes=${windowMinutes}`),

  traceSpans: (traceId: string) =>
    request<{ traceId: string; spans: SpanRecord[] }>(`/traces/${traceId}`),
};

/**
 * Stream a command as it runs.
 *
 * The server answers `application/x-ndjson`, so frames arrive as they are
 * produced instead of at the end. The reader is cancelled when the caller stops
 * iterating, which closes the response.
 */
export async function* streamCommand(
  sandboxId: string,
  command: string,
  opts?: { cwd?: string; timeoutSeconds?: number; signal?: AbortSignal },
): AsyncGenerator<
  | { type: "started"; commandId: string; startedAt: string }
  | { type: "stdout" | "stderr"; data: string }
  | {
      type: "exit";
      success: boolean;
      exitCode: number | null;
      timedOut: boolean;
      commandId: string;
    }
  | { type: "error"; error: string; message: string }
> {
  const res = await fetch(`${BASE}/sandboxes/${sandboxId}/commands`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ command, stream: true, ...opts }),
    signal: opts?.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = res.statusText;
    let code = `http_${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      message = parsed.message ?? message;
      code = parsed.code ?? code;
    } catch {
      /* keep the status text */
    }
    yield { type: "error", error: code, message };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (line) yield JSON.parse(line);

      newline = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();

  if (tail) yield JSON.parse(tail);
}

/* -------------------------------------------------------------------- files */

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  mode: string;
  modifiedAt: string;
}

export const files = {
  list: (id: string, path: string) =>
    request<{ path: string; files: FileEntry[]; truncated: boolean }>(
      `/sandboxes/${id}/files/list?path=${encodeURIComponent(path)}`,
    ),

  read: (id: string, path: string) =>
    request<{ path: string; encoding: "utf8" | "base64"; size: number; content: string }>(
      `/sandboxes/${id}/files?path=${encodeURIComponent(path)}`,
    ),

  info: (id: string, path: string) =>
    request<FileEntry>(`/sandboxes/${id}/files/info?path=${encodeURIComponent(path)}`),

  write: (id: string, path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
    request<{ path: string; size: number }>(`/sandboxes/${id}/files`, {
      method: "PUT",
      body: JSON.stringify({ path, content, encoding }),
    }),

  folder: (id: string, path: string) =>
    request<{ path: string }>(`/sandboxes/${id}/files/folder`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  remove: (id: string, path: string, recursive = false) =>
    request<{ path: string }>(
      `/sandboxes/${id}/files?path=${encodeURIComponent(path)}&recursive=${recursive}`,
      { method: "DELETE" },
    ),

  downloadUrl: (id: string, path: string, ttlSeconds = 300) =>
    request<{ url: string }>(`/sandboxes/${id}/files/download-url`, {
      method: "POST",
      body: JSON.stringify({ path, ttlSeconds }),
    }),

  search: (id: string, path: string, pattern: string) =>
    request<{ files: string[]; truncated: boolean }>(
      `/sandboxes/${id}/files/search?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`,
    ),
};

export interface TraceQuery {
  traceId?: string;
  requestId?: string;
  name?: string;
  status?: "ok" | "error";
  since?: string;
  limit?: number;
}

export interface TraceSummary {
  traceId: string;
  startedAt: string;
  durationMs: number;
  rootName: string;
  route: string | null;
  method: string | null;
  status: "ok" | "error";
  requestId: string | null;
  spanCount: number;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  statusCode: "unset" | "ok" | "error";
  statusMessage: string | null;
  attributes: Record<string, unknown>;
  requestId: string | null;
}

export interface TraceMetrics {
  windowMinutes: number;
  requests: number;
  errors: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  lifecycle: { name: string; count: number; p50Ms: number; p95Ms: number }[];
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  result?: "ok" | "error";
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { kind: "operator" | "user" | "system"; id: string | null; label: string | null };
  action: string;
  target: { type: string | null; id: string | null };
  result: "ok" | "error";
  status: number | null;
  errorCode: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

/** Non-password sign-in the server can complete (docs/decision/0036). */
export type LoginProviders = { github: boolean };

export type MePrincipal =
  | { kind: "operator"; via: "operator" }
  | {
      kind: "user";
      via: "key" | "session";
      userId: string;
      email: string;
      name: string;
      role: string;
      admin: boolean;
    };

/** One account, as `/users` returns it. */
export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  admin: boolean;
  banned: boolean;
  createdAt: string;
}

export type { Runtime };

export interface CreatedRuntime {
  runtime: Runtime;
  token: string;
}

export interface ApiKeyEntry {
  id: string;
  name: string;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  enabled: boolean;
}

export const LIVE_STATES: readonly SandboxState[] = ["ready", "running", "idle"];
