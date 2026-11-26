import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const createdAt = (column: string) => timestamp(column, { withTimezone: true, mode: "date" });

export const runtimes = pgTable(
  "runtimes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("offline"),
    draining: boolean("draining").notNull().default(false),
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    maxSandboxes: integer("max_sandboxes"),
    tokenHash: text("token_hash"),
    tokenPrefix: text("token_prefix"),
    driverKind: text("driver_kind"),
    capabilities: jsonb("capabilities").$type<{
      exec: boolean;
      files: boolean;
      persistence: boolean;
      networkPolicy?: boolean;
    }>(),
    vcpu: integer("vcpu"),
    memMib: integer("mem_mib"),
    portStart: integer("port_start"),
    portEnd: integer("port_end"),
    portBind: text("port_bind"),
    publicHost: text("public_host"),
    agentVersion: text("agent_version"),
    protocol: integer("protocol"),
    connectedAt: createdAt("connected_at"),
    lastSeenAt: createdAt("last_seen_at"),
    createdAt: createdAt("created_at").notNull(),
    updatedAt: createdAt("updated_at").notNull(),
  },
  (table) => [index("runtimes_token_idx").on(table.tokenHash)],
);

export const runtimeSamples = pgTable(
  "runtime_samples",
  {
    runtimeId: text("runtime_id").notNull(),
    at: createdAt("at").notNull(),
    activeSandboxes: integer("active_sandboxes").notNull(),
    vcpuCommitted: integer("vcpu_committed").notNull(),
    memMibCommitted: integer("mem_mib_committed").notNull(),
    vcpuCapacity: integer("vcpu_capacity"),
    memMibCapacity: integer("mem_mib_capacity"),
  },
  (table) => [
    primaryKey({ columns: [table.runtimeId, table.at] }),
    index("runtime_samples_at_idx").on(table.at),
  ],
);

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    type: text("type").notNull(),
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    env: jsonb("env").$type<Record<string, string>>().notNull().default({}),
    error: text("error"),
    url: text("url"),
    ip: text("ip"),
    createdAt: createdAt("created_at").notNull(),
    updatedAt: createdAt("updated_at").notNull(),
    stoppedAt: createdAt("stopped_at"),
    archiveAfter: createdAt("archive_after"),
    ttlSeconds: integer("ttl_seconds"),
    snapshotAt: createdAt("snapshot_at"),
    forkOf: text("fork_of"),
    driverRef: text("driver_ref"),
    hydrated: boolean("hydrated").notNull().default(true),
    hydratedAt: createdAt("hydrated_at"),
    ownerId: text("owner_id"),
    runtimeId: text("runtime_id").notNull().default("local"),
    setupStatus: text("setup_status").$type<"pending" | "running" | "done" | "failed">(),
    setupError: text("setup_error"),
    networkPolicy: jsonb("network_policy").$type<{
      mode: "default" | "open" | "deny" | "allow";
      allow: string[];
    }>(),
  },
  (table) => [
    index("sandboxes_state_idx").on(table.state),
    index("sandboxes_owner_idx").on(table.ownerId),
    index("sandboxes_runtime_idx").on(table.runtimeId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    createdAt: createdAt("created_at").notNull(),
    expiresAt: createdAt("expires_at").notNull(),
  },
  (table) => [index("idempotency_keys_expires_idx").on(table.expiresAt)],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    name: text("name"),
    state: text("state").notNull(),
    createdAt: createdAt("created_at").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    driverRef: text("driver_ref"),
    manifest: jsonb("manifest").$type<{ path: string; kind: string; size?: number }[]>(),
    ownerId: text("owner_id"),
    runtimeId: text("runtime_id").notNull().default("local"),
  },
  (table) => [
    index("snapshots_sandbox_idx").on(table.sandboxId),
    index("snapshots_owner_idx").on(table.ownerId),
    index("snapshots_runtime_idx").on(table.runtimeId),
  ],
);

export const savedSnapshots = pgTable("saved_snapshots", {
  name: text("name").primaryKey(),
  status: text("status").notNull(),
  error: text("error"),
  sourceSandboxId: text("source_sandbox_id").notNull(),
  snapshotId: text("snapshot_id"),
  type: text("type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  createdAt: createdAt("created_at").notNull(),
  ownerId: text("owner_id"),
});

export const snapshotShares = pgTable(
  "snapshot_shares",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    codeHash: text("code_hash").notNull(),
    codePrefix: text("code_prefix").notNull(),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: createdAt("last_used_at"),
    revokedAt: createdAt("revoked_at"),
    createdAt: createdAt("created_at").notNull(),
  },
  (table) => [index("snapshot_shares_name_idx").on(table.name)],
);

export const commands = pgTable(
  "commands",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    command: text("command").notNull(),
    cwd: text("cwd"),
    pid: integer("pid"),
    mode: text("mode").notNull().default("sync"),
    killed: boolean("killed").notNull().default(false),
    exitCode: integer("exit_code"),
    stdout: text("stdout").notNull().default(""),
    stderr: text("stderr").notNull().default(""),
    timedOut: integer("timed_out").notNull().default(0),
    startedAt: createdAt("started_at").notNull(),
    finishedAt: createdAt("finished_at"),
  },
  (table) => [index("commands_sandbox_idx").on(table.sandboxId, table.startedAt)],
);

export const stops = pgTable(
  "stops",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    status: text("status").notNull().default("pending"),
    requestedAt: createdAt("requested_at"),
    lastAttemptAt: createdAt("last_attempt_at"),
    error: text("error"),
    endedAt: createdAt("ended_at"),
    forced: boolean("forced").notNull().default(false),
  },
  (table) => [index("stops_sandbox_idx").on(table.sandboxId, table.requestedAt)],
);

export const machineSizes = pgTable("machine_sizes", {
  name: text("name").primaryKey(),
  vcpu: integer("vcpu").notNull(),
  memMib: integer("mem_mib").notNull(),
  diskGb: integer("disk_gb").notNull(),
  description: text("description"),
  retiredAt: createdAt("retired_at"),
  createdAt: createdAt("created_at").notNull(),
  updatedAt: createdAt("updated_at").notNull(),
});

export const sandboxPorts = pgTable(
  "sandbox_ports",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    guestPort: integer("guest_port").notNull(),
    hostPort: integer("host_port").notNull(),
    bind: text("bind").notNull(),
    title: text("title"),
    public: boolean("public").notNull().default(false),
    localhost: boolean("localhost").notNull().default(false),
    explicit: boolean("explicit").notNull().default(false),
    createdAt: createdAt("created_at").notNull(),
  },
  (table) => [
    index("sandbox_ports_sandbox_idx").on(table.sandboxId),
    index("sandbox_ports_host_idx").on(table.hostPort),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: createdAt("at").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    result: text("result").notNull(),
    status: integer("status"),
    errorCode: text("error_code"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ownerId: text("owner_id"),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_owner_idx").on(table.ownerId, table.at),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_target_idx").on(table.targetId),
  ],
);

export const spans = pgTable(
  "spans",
  {
    traceId: text("trace_id").notNull(),
    spanId: text("span_id").primaryKey(),
    parentSpanId: text("parent_span_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    startedAt: createdAt("started_at").notNull(),
    endedAt: createdAt("ended_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    statusCode: text("status_code").notNull(),
    statusMessage: text("status_message"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    requestId: text("request_id"),
    ownerId: text("owner_id"),
  },
  (table) => [
    index("spans_trace_idx").on(table.traceId),
    index("spans_started_idx").on(table.startedAt),
    index("spans_request_idx").on(table.requestId),
    index("spans_owner_idx").on(table.ownerId, table.startedAt),
    index("spans_name_idx").on(table.name),
  ],
);

export const events = pgTable(
  "events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    sandboxId: text("sandbox_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    at: createdAt("at").notNull(),
  },
  (table) => [index("events_sandbox_idx").on(table.sandboxId, table.id)],
);

export type SandboxRow = typeof sandboxes.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type CommandRow = typeof commands.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type SavedSnapshotRow = typeof savedSnapshots.$inferSelect;
export type SandboxPortRow = typeof sandboxPorts.$inferSelect;
export type SnapshotShareRow = typeof snapshotShares.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type SpanRow = typeof spans.$inferSelect;
export type MachineSizeRow = typeof machineSizes.$inferSelect;
export type RuntimeRow = typeof runtimes.$inferSelect;
export type RuntimeSampleRow = typeof runtimeSamples.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
