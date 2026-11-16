import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Storage for the sandbox lifecycle.
 *
 * Timestamps are `timestamptz` in `mode: "date"`: PostgreSQL compares and orders
 * them as time and the driver hands back `Date` objects. They are turned into
 * ISO-8601 strings where they leave the store, because that is what boat's
 * contract expects. (`mode: "string"` looks tempting and is wrong: drizzle
 * formats the UTC clock with the *local* offset, which silently shifts every
 * timestamp by the server's timezone.) JSON columns are `jsonb` so drizzle
 * parses them once, in the store, instead of every caller.
 */

const createdAt = (column: string) => timestamp(column, { withTimezone: true, mode: "date" });

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Mirrors boat's Sandbox.state enum. */
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
    /** Driver-owned pointer: `vm:<id>`, `disk:<path>` or `snap:<id>`. */
    driverRef: text("driver_ref"),
    hydrated: boolean("hydrated").notNull().default(true),
    hydratedAt: createdAt("hydrated_at"),
    /** Better Auth user id that owns this sandbox; null for the operator key. */
    ownerId: text("owner_id"),
  },
  (table) => [
    index("sandboxes_state_idx").on(table.state),
    index("sandboxes_owner_idx").on(table.ownerId),
  ],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    name: text("name"),
    /** creating | ready | error */
    state: text("state").notNull(),
    createdAt: createdAt("created_at").notNull(),
    sizeBytes: integer("size_bytes"),
    driverRef: text("driver_ref"),
    /** Cached JSON file listing (SnapshotTreeEntry[]) for /snapshots/{id}/tree. */
    manifest: jsonb("manifest").$type<{ path: string; kind: string; size?: number }[]>(),
    /** Copied from the sandbox so a snapshot dies with its owner, not with the id. */
    ownerId: text("owner_id"),
  },
  (table) => [
    index("snapshots_sandbox_idx").on(table.sandboxId),
    index("snapshots_owner_idx").on(table.ownerId),
  ],
);

/** A snapshot saved under a user-chosen name; survives the source sandbox. */
export const savedSnapshots = pgTable("saved_snapshots", {
  name: text("name").primaryKey(),
  /** saving | ready | failed */
  status: text("status").notNull(),
  error: text("error"),
  sourceSandboxId: text("source_sandbox_id").notNull(),
  snapshotId: text("snapshot_id"),
  type: text("type"),
  sizeBytes: integer("size_bytes"),
  createdAt: createdAt("created_at").notNull(),
  ownerId: text("owner_id"),
});

/** Secret codes that let another account deploy a saved snapshot. */
export const snapshotShares = pgTable(
  "snapshot_shares",
  {
    id: text("id").primaryKey(),
    /** Saved snapshot name. */
    name: text("name").notNull(),
    /** Only the hash is kept; the code itself is shown once. */
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
    /** Guest pid for detached commands; also the public `processId`. */
    pid: integer("pid"),
    /** sync | stream | detached | process — mirrors boat's CommandRecord.mode. */
    mode: text("mode").notNull().default("sync"),
    /** Set when DELETE /commands/{processId} ended it. */
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
    /** pending | failing | completed | superseded */
    status: text("status").notNull().default("pending"),
    requestedAt: createdAt("requested_at"),
    lastAttemptAt: createdAt("last_attempt_at"),
    error: text("error"),
    endedAt: createdAt("ended_at"),
    forced: boolean("forced").notNull().default(false),
  },
  (table) => [index("stops_sandbox_idx").on(table.sandboxId, table.requestedAt)],
);

/** A guest port published on the host and proxied by the API. */
export const sandboxPorts = pgTable(
  "sandbox_ports",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id").notNull(),
    guestPort: integer("guest_port").notNull(),
    hostPort: integer("host_port").notNull(),
    bind: text("bind").notNull(),
    title: text("title"),
    /** When false the preview URL requires its `_token`. */
    public: boolean("public").notNull().default(false),
    /** Set when the guest service listens on loopback only. */
    localhost: boolean("localhost").notNull().default(false),
    /**
     * True when someone asked for this port through `POST /host`. False for the
     * ports reserved at create time, which are mapped but not "published" in any
     * sense the user expressed.
     */
    explicit: boolean("explicit").notNull().default(false),
    createdAt: createdAt("created_at").notNull(),
  },
  (table) => [
    index("sandbox_ports_sandbox_idx").on(table.sandboxId),
    index("sandbox_ports_host_idx").on(table.hostPort),
  ],
);

/**
 * Append-only record of who did what. Written by one function in the API
 * (modules/audit); there is no update or delete path (decision 0031).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: createdAt("at").notNull(),
    /** operator | user | system */
    actorKind: text("actor_kind").notNull(),
    /** user id, api key id, or null for the operator and system work. */
    actorId: text("actor_id"),
    /** Email, key prefix, or "operator" — what a human should read. */
    actorLabel: text("actor_label"),
    /** `sandbox.create`, `auth.sign_in`, … */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** ok | error */
    result: text("result").notNull(),
    status: integer("status"),
    errorCode: text("error_code"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** Whose log this is; null for operator and system rows. */
    ownerId: text("owner_id"),
  },
  (table) => [
    index("audit_log_at_idx").on(table.at),
    index("audit_log_owner_idx").on(table.ownerId, table.at),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_target_idx").on(table.targetId),
  ],
);

/**
 * One finished span. Written by the OpenTelemetry exporter in modules/traces;
 * the table doubles as the trace store when no collector is configured
 * (decision 0032).
 */
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
    /** Whose trace this is; null for operator and system work. */
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
    /** Explicit ids are allowed so an import can preserve them; see the sequence reset in the script. */
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
