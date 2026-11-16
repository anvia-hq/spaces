import {
  and,
  asc,
  createDb,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  or,
  sql,
  commands,
  events,
  isNull,
  machineSizes,
  sandboxes,
  sandboxPorts,
  savedSnapshots,
  snapshotShares,
  snapshots,
  spans_,
  stops,
  type CommandRow,
  type EventRow,
  type MachineSizeRow,
  type SandboxPortRow,
  type SandboxRow,
  type SavedSnapshotRow,
  type SnapshotRow,
  type SnapshotShareRow,
  type AuditLogRow,
  type StopRow,
  auditLog,
  type SQL,
} from "@spaces/db";
import type { Sandbox, SandboxState, SandboxType } from "@spaces/shared/sandbox";
import { config } from "./config.ts";
import { canSee, currentOwnerId, scopedOwner } from "./scope.ts";
import { tracedStore } from "./modules/traces/proxies.ts";

export type { SavedSnapshotRow, SnapshotShareRow } from "@spaces/db";

const handle = createDb(config.databaseUrl);
export const db = handle.db;

/** Migrations run once, before the first request can reach the store. */
await handle.migrate();

export type { CommandRow, SandboxRow, SnapshotRow };

export const now = () => new Date().toISOString();

/** ISO-8601 on the wire, `Date` in the driver: two helpers, one direction each. */
export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const at = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

/** First row of a query, or null — Postgres has no `.get()`. */
export async function one<T>(query: PromiseLike<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

export interface ListFilter {
  states?: SandboxState[];
  name?: string;
  namePrefix?: string;
  labels?: string[];
}

/** DB row -> API shape. `jsonb` columns arrive parsed; nothing to decode here. */
function toSandbox(row: SandboxRow): Sandbox {
  return {
    id: row.id,
    name: row.name,
    state: row.state as SandboxState,
    type: row.type as SandboxType,
    error: row.error,
    url: row.url,
    ip: row.ip,
    labels: row.labels,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stoppedAt: iso(row.stoppedAt),
    archiveAfter: iso(row.archiveAfter),
    desktopAvailable: false,
    desktopUrl: null,
    snapshotAvailable: row.snapshotAt !== null,
    snapshotCompletedAt: iso(row.snapshotAt),
    hydrated: row.hydrated,
    hydratedAt: iso(row.hydratedAt),
  };
}

const rawStore = {
  async list(filter: ListFilter = {}): Promise<Sandbox[]> {
    const where = [];
    const owner = scopedOwner();

    if (owner) where.push(eq(sandboxes.ownerId, owner));

    if (filter.states?.length) where.push(inArray(sandboxes.state, filter.states));

    if (filter.name !== undefined) where.push(eq(sandboxes.name, filter.name));

    if (filter.namePrefix !== undefined) where.push(like(sandboxes.name, `${filter.namePrefix}%`));

    const rows = await db
      .select()
      .from(sandboxes)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(sandboxes.createdAt));

    const mapped = rows.map(toSandbox);

    // Label filters are conjunctive: every `key=value` must match.
    return (filter.labels ?? []).reduce<Sandbox[]>((acc, raw) => {
      const idx = raw.indexOf("=");
      const key = idx === -1 ? raw : raw.slice(0, idx);
      const value = idx === -1 ? "" : raw.slice(idx + 1);
      return acc.filter((row) => row.labels[key!] === value);
    }, mapped);
  },

  async get(id: string): Promise<Sandbox | null> {
    const row = await this.raw(id);
    return row ? toSandbox(row) : null;
  },

  async raw(id: string): Promise<SandboxRow | null> {
    const row = await one(db.select().from(sandboxes).where(eq(sandboxes.id, id)));
    return row && canSee(row.ownerId) ? row : null;
  },

  async insert(s: {
    id: string;
    name: string;
    state: SandboxState;
    type: SandboxType;
    labels?: Record<string, string>;
    env?: Record<string, string>;
    ttlSeconds: number | null;
    archiveAfter: string | null;
    forkOf?: string | null;
  }) {
    const ts = now();
    await db.insert(sandboxes).values({
      id: s.id,
      name: s.name,
      state: s.state,
      type: s.type,
      labels: s.labels ?? {},
      env: s.env ?? {},
      ttlSeconds: s.ttlSeconds,
      archiveAfter: at(s.archiveAfter),
      forkOf: s.forkOf ?? null,
      ownerId: currentOwnerId(),
      createdAt: at(ts)!,
      updatedAt: at(ts)!,
    });
  },

  async update(
    id: string,
    patch: Partial<{
      name: string;
      type: SandboxType;
      ttlSeconds: number | null;
      state: SandboxState;
      error: string | null;
      url: string | null;
      ip: string | null;
      labels: Record<string, string>;
      stoppedAt: string | null;
      archiveAfter: string | null;
      snapshotAt: string | null;
      driverRef: string | null;
      hydrated: boolean;
      hydratedAt: string | null;
    }>,
  ) {
    const values: {
      name?: string;
      type?: SandboxType;
      ttlSeconds?: number | null;
      state?: SandboxState;
      error?: string | null;
      url?: string | null;
      ip?: string | null;
      labels?: Record<string, string>;
      driverRef?: string | null;
      hydrated?: boolean;
      updatedAt: Date;
      stoppedAt?: Date | null;
      archiveAfter?: Date | null;
      snapshotAt?: Date | null;
      hydratedAt?: Date | null;
    } = { updatedAt: at(now())! };

    if (patch.name !== undefined) values.name = patch.name;

    if (patch.type !== undefined) values.type = patch.type;

    if (patch.ttlSeconds !== undefined) values.ttlSeconds = patch.ttlSeconds;

    if (patch.state !== undefined) values.state = patch.state;

    if (patch.error !== undefined) values.error = patch.error;

    if (patch.url !== undefined) values.url = patch.url;

    if (patch.ip !== undefined) values.ip = patch.ip;

    if (patch.labels !== undefined) values.labels = patch.labels;

    if (patch.driverRef !== undefined) values.driverRef = patch.driverRef;

    if (patch.hydrated !== undefined) values.hydrated = patch.hydrated;

    if (patch.stoppedAt !== undefined) values.stoppedAt = at(patch.stoppedAt);

    if (patch.archiveAfter !== undefined) values.archiveAfter = at(patch.archiveAfter);

    if (patch.snapshotAt !== undefined) values.snapshotAt = at(patch.snapshotAt);

    if (patch.hydratedAt !== undefined) values.hydratedAt = at(patch.hydratedAt);

    await db.update(sandboxes).set(values).where(eq(sandboxes.id, id));
  },

  async remove(id: string) {
    await db.delete(sandboxes).where(eq(sandboxes.id, id));
  },

  async env(id: string): Promise<Record<string, string>> {
    const row = await this.raw(id);
    return row ? row.env : {};
  },

  /* -------------------------------------------------------- machine sizes */

  async insertMachineSize(s: {
    name: string;
    vcpu: number;
    memMib: number;
    diskGb: number;
    description?: string | null;
    at: Date;
  }) {
    await db.insert(machineSizes).values({
      name: s.name,
      vcpu: s.vcpu,
      memMib: s.memMib,
      diskGb: s.diskGb,
      description: s.description ?? null,
      createdAt: s.at,
      updatedAt: s.at,
    });
  },

  async listMachineSizes(includeRetired: boolean): Promise<MachineSizeRow[]> {
    const query = db.select().from(machineSizes);
    const active = includeRetired ? query : query.where(isNull(machineSizes.retiredAt));
    return active.orderBy(asc(machineSizes.vcpu), asc(machineSizes.name));
  },

  async machineSize(name: string): Promise<MachineSizeRow | null> {
    return one(db.select().from(machineSizes).where(eq(machineSizes.name, name)));
  },

  async updateMachineSize(
    name: string,
    patch: {
      vcpu?: number;
      memMib?: number;
      diskGb?: number;
      description?: string | null;
      retiredAt?: string | null;
    },
  ) {
    const values: {
      updatedAt: Date;
      vcpu?: number;
      memMib?: number;
      diskGb?: number;
      description?: string | null;
      retiredAt?: Date | null;
    } = { updatedAt: at(now())! };

    if (patch.vcpu !== undefined) values.vcpu = patch.vcpu;

    if (patch.memMib !== undefined) values.memMib = patch.memMib;

    if (patch.diskGb !== undefined) values.diskGb = patch.diskGb;

    if (patch.description !== undefined) values.description = patch.description;

    if (patch.retiredAt !== undefined) values.retiredAt = at(patch.retiredAt);

    await db.update(machineSizes).set(values).where(eq(machineSizes.name, name));
  },

  /** How many sandboxes were created at this size, retired or not. */
  async countOfType(type: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(eq(sandboxes.type, type));
    return Number(rows[0]?.n ?? 0);
  },

  /* ------------------------------------------------------------ snapshots */

  async listSnapshots(sandboxId?: string): Promise<SnapshotRow[]> {
    const owner = scopedOwner();
    const conditions = [];

    if (sandboxId) conditions.push(eq(snapshots.sandboxId, sandboxId));

    if (owner) conditions.push(eq(snapshots.ownerId, owner));

    const query = db.select().from(snapshots);
    const scoped = conditions.length ? query.where(and(...conditions)) : query;
    return scoped.orderBy(desc(snapshots.createdAt));
  },

  async insertSnapshot(s: {
    id: string;
    sandboxId: string;
    name: string | null;
    state: "creating" | "ready" | "error";
    sizeBytes?: number | null;
    driverRef?: string | null;
  }) {
    await db.insert(snapshots).values({
      id: s.id,
      sandboxId: s.sandboxId,
      name: s.name,
      state: s.state,
      createdAt: at(now())!,
      sizeBytes: s.sizeBytes ?? null,
      driverRef: s.driverRef ?? null,
      ownerId: currentOwnerId(),
    });
  },

  async getSnapshot(id: string): Promise<SnapshotRow | null> {
    const row = await one(db.select().from(snapshots).where(eq(snapshots.id, id)));
    return row && canSee(row.ownerId) ? row : null;
  },

  async removeSnapshot(id: string) {
    await db.delete(snapshots).where(eq(snapshots.id, id));
  },

  /* ------------------------------------------------------------- commands */

  async insertCommand(c: {
    id: string;
    sandboxId: string;
    command: string;
    cwd: string | null;
    startedAt: string;
    pid?: number | null;
    mode?: "sync" | "stream" | "detached" | "process";
  }) {
    await db.insert(commands).values({
      id: c.id,
      sandboxId: c.sandboxId,
      command: c.command,
      cwd: c.cwd,
      startedAt: at(c.startedAt)!,
      pid: c.pid ?? null,
      mode: c.mode ?? "sync",
    });
  },

  /** Public id alias for the command record. */
  async commandById(id: string): Promise<CommandRow | null> {
    const row = await one(db.select().from(commands).where(eq(commands.id, id)));
    return row && (await this.raw(row.sandboxId)) ? row : null;
  },

  async markCommandKilled(id: string) {
    await db.update(commands).set({ killed: true }).where(eq(commands.id, id));
  },

  /** Resolve a public `processId` (guest pid) to its command record. */
  async findCommandByPid(sandboxId: string, pid: number): Promise<CommandRow | null> {
    if (!(await this.raw(sandboxId))) return null;

    return one(
      db
        .select()
        .from(commands)
        .where(and(eq(commands.sandboxId, sandboxId), eq(commands.pid, pid)))
        .orderBy(desc(commands.startedAt)),
    );
  },

  async finishCommand(
    id: string,
    r: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      finishedAt: string;
    },
  ) {
    await db
      .update(commands)
      .set({
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut ? 1 : 0,
        finishedAt: at(r.finishedAt),
      })
      .where(eq(commands.id, id));
  },

  async listCommands(sandboxId: string, limit = 50): Promise<CommandRow[]> {
    if (!(await this.raw(sandboxId))) return [];

    return db
      .select()
      .from(commands)
      .where(eq(commands.sandboxId, sandboxId))
      .orderBy(desc(commands.startedAt))
      .limit(limit);
  },

  async getCommand(id: string): Promise<CommandRow | null> {
    const row = await one(db.select().from(commands).where(eq(commands.id, id)));
    return row && (await this.raw(row.sandboxId)) ? row : null;
  },

  /* --------------------------------------------------------- ports */

  async insertPort(r: {
    id: string;
    sandboxId: string;
    guestPort: number;
    hostPort: number;
    bind: string;
    title?: string | null;
    public?: boolean;
    localhost?: boolean;
    explicit?: boolean;
    createdAt: string;
  }) {
    await db.insert(sandboxPorts).values({
      id: r.id,
      sandboxId: r.sandboxId,
      guestPort: r.guestPort,
      hostPort: r.hostPort,
      bind: r.bind,
      title: r.title ?? null,
      public: r.public ?? false,
      localhost: r.localhost ?? false,
      explicit: r.explicit ?? false,
      createdAt: at(r.createdAt)!,
    });
  },

  async getPort(sandboxId: string, guestPort: number): Promise<SandboxPortRow | null> {
    return one(
      db
        .select()
        .from(sandboxPorts)
        .where(and(eq(sandboxPorts.sandboxId, sandboxId), eq(sandboxPorts.guestPort, guestPort))),
    );
  },

  async listPorts(sandboxId: string): Promise<SandboxPortRow[]> {
    return db.select().from(sandboxPorts).where(eq(sandboxPorts.sandboxId, sandboxId));
  },

  async allHostPorts(): Promise<number[]> {
    const rows = await db.select({ hostPort: sandboxPorts.hostPort }).from(sandboxPorts);
    return rows.map((r) => r.hostPort);
  },

  async updatePort(
    id: string,
    patch: { title?: string | null; public?: boolean; localhost?: boolean; explicit?: boolean },
  ) {
    await db.update(sandboxPorts).set(patch).where(eq(sandboxPorts.id, id));
  },

  async deletePort(id: string) {
    await db.delete(sandboxPorts).where(eq(sandboxPorts.id, id));
  },

  async deletePortsOf(sandboxId: string) {
    await db.delete(sandboxPorts).where(eq(sandboxPorts.sandboxId, sandboxId));
  },

  /* ------------------------------------------------------ saved snapshots */

  async upsertSavedSnapshot(r: {
    name: string;
    status: "saving" | "ready" | "failed";
    error?: string | null;
    sourceSandboxId: string;
    snapshotId?: string | null;
    type?: string | null;
    sizeBytes?: number | null;
    createdAt: string;
  }) {
    await db
      .insert(savedSnapshots)
      .values({
        name: r.name,
        status: r.status,
        error: r.error ?? null,
        sourceSandboxId: r.sourceSandboxId,
        snapshotId: r.snapshotId ?? null,
        type: r.type ?? null,
        sizeBytes: r.sizeBytes ?? null,
        createdAt: at(r.createdAt)!,
        ownerId: currentOwnerId(),
      })
      .onConflictDoUpdate({
        target: savedSnapshots.name,
        set: {
          status: r.status,
          error: r.error ?? null,
          sourceSandboxId: r.sourceSandboxId,
          snapshotId: r.snapshotId ?? null,
          type: r.type ?? null,
          sizeBytes: r.sizeBytes ?? null,
          createdAt: at(r.createdAt)!,
        },
      });
  },

  async listSavedSnapshots(
    filter: { name?: string; namePrefix?: string } = {},
  ): Promise<SavedSnapshotRow[]> {
    const conditions = [];
    const owner = scopedOwner();

    if (owner) conditions.push(eq(savedSnapshots.ownerId, owner));

    if (filter.name) conditions.push(eq(savedSnapshots.name, filter.name));

    if (filter.namePrefix) conditions.push(like(savedSnapshots.name, `${filter.namePrefix}%`));

    const query = db.select().from(savedSnapshots);
    const scoped = conditions.length ? query.where(and(...conditions)) : query;
    return scoped.orderBy(desc(savedSnapshots.createdAt));
  },

  /** The owner of a saved name, ignoring scope: names are unique server-wide. */
  async savedSnapshotOwner(name: string): Promise<string | null | undefined> {
    const row = await one(
      db
        .select({ ownerId: savedSnapshots.ownerId })
        .from(savedSnapshots)
        .where(eq(savedSnapshots.name, name)),
    );
    return row ? row.ownerId : undefined;
  },

  async getSavedSnapshot(name: string): Promise<SavedSnapshotRow | null> {
    const row = await one(db.select().from(savedSnapshots).where(eq(savedSnapshots.name, name)));
    return row && canSee(row.ownerId) ? row : null;
  },

  async deleteSavedSnapshot(name: string) {
    await db.delete(savedSnapshots).where(eq(savedSnapshots.name, name));
  },

  /** Saved snapshots that pointed at an artifact that no longer exists. */
  async deleteSavedSnapshotsBySnapshotId(snapshotId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(savedSnapshots)
      .where(eq(savedSnapshots.snapshotId, snapshotId));

    for (const row of rows) {
      await db.delete(snapshotShares).where(eq(snapshotShares.name, row.name));
      await db.delete(savedSnapshots).where(eq(savedSnapshots.name, row.name));
    }

    return rows.map((r) => r.name);
  },

  async setSnapshotManifest(
    snapshotId: string,
    manifest: { path: string; kind: string; size?: number }[],
  ) {
    await db.update(snapshots).set({ manifest }).where(eq(snapshots.id, snapshotId));
  },

  /* ---------------------------------------------------------- snapshot shares */

  async insertShare(r: {
    id: string;
    name: string;
    codeHash: string;
    codePrefix: string;
    createdAt: string;
  }) {
    await db.insert(snapshotShares).values({ ...r, createdAt: at(r.createdAt)! });
  },

  async listShares(name: string): Promise<SnapshotShareRow[]> {
    return db
      .select()
      .from(snapshotShares)
      .where(eq(snapshotShares.name, name))
      .orderBy(desc(snapshotShares.createdAt));
  },

  async getShare(id: string): Promise<SnapshotShareRow | null> {
    return one(db.select().from(snapshotShares).where(eq(snapshotShares.id, id)));
  },

  async revokeShare(id: string, at_: string) {
    await db
      .update(snapshotShares)
      .set({ revokedAt: at(at_) })
      .where(eq(snapshotShares.id, id));
  },

  async deleteSharesOf(name: string) {
    await db.delete(snapshotShares).where(eq(snapshotShares.name, name));
  },

  /* ---------------------------------------------------------------- stops */

  async insertStop(s2: {
    id: string;
    sandboxId: string;
    status: "pending" | "failing" | "completed" | "superseded";
    requestedAt: string;
    forced?: boolean;
  }) {
    await db.insert(stops).values({
      id: s2.id,
      sandboxId: s2.sandboxId,
      status: s2.status,
      requestedAt: at(s2.requestedAt),
      forced: s2.forced ?? false,
    });
  },

  async updateStop(
    id: string,
    patch: {
      status?: "pending" | "failing" | "completed" | "superseded";
      lastAttemptAt?: string | null;
      error?: string | null;
      endedAt?: string | null;
      forced?: boolean;
    },
  ) {
    const values: {
      status?: "pending" | "failing" | "completed" | "superseded";
      error?: string | null;
      forced?: boolean;
      lastAttemptAt?: Date | null;
      endedAt?: Date | null;
    } = {};

    if (patch.status !== undefined) values.status = patch.status;

    if (patch.error !== undefined) values.error = patch.error;

    if (patch.forced !== undefined) values.forced = patch.forced;

    if (patch.lastAttemptAt !== undefined) values.lastAttemptAt = at(patch.lastAttemptAt);

    if (patch.endedAt !== undefined) values.endedAt = at(patch.endedAt);

    await db.update(stops).set(values).where(eq(stops.id, id));
  },

  async getStop(id: string): Promise<StopRow | null> {
    return one(db.select().from(stops).where(eq(stops.id, id)));
  },

  /** Most recent stop id for a sandbox, completed or not. */
  async lastStopId(sandboxId: string): Promise<string | null> {
    const row = await one(
      db
        .select({ id: stops.id })
        .from(stops)
        .where(eq(stops.sandboxId, sandboxId))
        .orderBy(desc(stops.requestedAt)),
    );
    return row?.id ?? null;
  },

  /** The stop currently in flight for a sandbox, if any. */
  async pendingStop(sandboxId: string): Promise<StopRow | null> {
    return one(
      db
        .select()
        .from(stops)
        .where(and(eq(stops.sandboxId, sandboxId), inArray(stops.status, ["pending", "failing"])))
        .orderBy(desc(stops.requestedAt)),
    );
  },

  /** Every event of a sandbox, oldest first — the usage meter walks these. */
  async allEvents(sandboxId: string): Promise<EventRow[]> {
    if (!(await this.raw(sandboxId))) return [];

    return db.select().from(events).where(eq(events.sandboxId, sandboxId)).orderBy(asc(events.id));
  },

  /* --------------------------------------------------------------- events */

  async event(sandboxId: string, type: string, payload: Record<string, unknown> = {}) {
    await db.insert(events).values({ sandboxId, type, payload, at: at(now())! });
  },

  async listEvents(sandboxId: string, afterId = 0, limit = 100): Promise<EventRow[]> {
    if (!(await this.raw(sandboxId))) return [];

    return db
      .select()
      .from(events)
      .where(and(eq(events.sandboxId, sandboxId), gt(events.id, afterId)))
      .orderBy(asc(events.id))
      .limit(limit);
  },

  async counts(): Promise<{ sandboxes: number; running: number; snapshots: number }> {
    const owner = scopedOwner();
    const sandboxRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(owner ? eq(sandboxes.ownerId, owner) : undefined);
    const snapshotRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(snapshots)
      .where(owner ? eq(snapshots.ownerId, owner) : undefined);
    const running = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(
        owner
          ? and(
              inArray(sandboxes.state, ["ready", "running", "provisioning"]),
              eq(sandboxes.ownerId, owner),
            )
          : inArray(sandboxes.state, ["ready", "running", "provisioning"]),
      );

    return {
      sandboxes: Number(sandboxRows[0]?.n ?? 0),
      running: Number(running[0]?.n ?? 0),
      snapshots: Number(snapshotRows[0]?.n ?? 0),
    };
  },

  /* ----------------------------------------------------------------- spans */

  async insertSpans(
    spans: {
      traceId: string;
      spanId: string;
      parentSpanId: string | null;
      name: string;
      kind: string;
      startedAt: string;
      endedAt: string;
      durationMs: number;
      statusCode: string;
      statusMessage: string | null;
      attributes: Record<string, unknown>;
      requestId: string | null;
      ownerId: string | null;
    }[],
  ) {
    if (spans.length === 0) return;

    await db.insert(spans_).values(
      spans.map((span) => ({
        ...span,
        startedAt: at(span.startedAt)!,
        endedAt: at(span.endedAt)!,
      })),
    );
  },

  /** Recent traces: one row per trace id, with its root span's shape. */
  async listTraces(
    filter: { traceId?: string; requestId?: string; name?: string; status?: "ok" | "error" },
    limit: number,
  ) {
    const owner = scopedOwner();
    const conditions: SQL[] = [];

    if (owner) conditions.push(eq(spans_.ownerId, owner));

    if (filter.traceId) conditions.push(eq(spans_.traceId, filter.traceId));

    if (filter.requestId) conditions.push(eq(spans_.requestId, filter.requestId));

    if (filter.status)
      conditions.push(eq(spans_.statusCode, filter.status === "ok" ? "ok" : "error"));

    const rows = await db
      .select()
      .from(spans_)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(spans_.startedAt))
      .limit(limit * 20);

    const traces = new Map<string, typeof rows>();

    for (const row of rows) {
      const existing = traces.get(row.traceId);

      if (!existing) traces.set(row.traceId, [row]);
      else existing.push(row);
    }

    const summarised = [...traces.entries()].map(([traceId, group]) => {
      const root = group.find((span) => !span.parentSpanId) ?? group[0]!;
      const started = Math.min(...group.map((span) => span.startedAt.getTime()));
      const ended = Math.max(...group.map((span) => span.endedAt.getTime()));
      const http = group.find((span) => span.name === "http.request");
      const route = http?.attributes["http.route"];
      const method = http?.attributes["http.method"];

      return {
        traceId,
        startedAt: new Date(started).toISOString(),
        durationMs: Math.max(0, ended - started),
        rootName: root.name,
        route: typeof route === "string" ? route : null,
        method: typeof method === "string" ? method : null,
        // The request's own outcome, not a swallowed child failure: a mock
        // driver refusing port publishing is not a failed request.
        status: (http ?? root).statusCode === "error" ? "error" : "ok",
        requestId: root.requestId,
        spanCount: group.length,
      };
    });

    return summarised
      .filter((trace) => !filter.name || trace.rootName === filter.name)
      .slice(0, limit);
  },

  async spansOfTrace(traceId: string) {
    const owner = scopedOwner();
    const conditions: SQL[] = [eq(spans_.traceId, traceId)];

    if (owner) conditions.push(eq(spans_.ownerId, owner));

    const rows = await db
      .select()
      .from(spans_)
      .where(and(...conditions))
      .orderBy(asc(spans_.startedAt));

    return rows.map((row) => ({
      traceId: row.traceId,
      spanId: row.spanId,
      parentSpanId: row.parentSpanId,
      name: row.name,
      kind: row.kind,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      durationMs: row.durationMs,
      statusCode: row.statusCode,
      statusMessage: row.statusMessage,
      attributes: row.attributes,
      requestId: row.requestId,
    }));
  },

  /** Request rate, error rate, latency percentiles and lifecycle durations. */
  async traceMetrics(windowMinutes: number) {
    const owner = scopedOwner();
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const where = owner
      ? and(eq(spans_.ownerId, owner), gte(spans_.startedAt, since))
      : gte(spans_.startedAt, since);

    const requests = await db
      .select({
        n: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${spans_.statusCode} = 'error')::int`,
        p50: sql<number>`coalesce(percentile_disc(0.5) within group (order by ${spans_.durationMs}), 0)::int`,
        p95: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${spans_.durationMs}), 0)::int`,
      })
      .from(spans_)
      .where(and(eq(spans_.name, "http.request"), where));

    const lifecycle = await db
      .select({
        name: spans_.name,
        n: sql<number>`count(*)::int`,
        p50: sql<number>`coalesce(percentile_disc(0.5) within group (order by ${spans_.durationMs}), 0)::int`,
        p95: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${spans_.durationMs}), 0)::int`,
      })
      .from(spans_)
      .where(and(like(spans_.name, "sandbox.%"), where))
      .groupBy(spans_.name);

    const row = requests[0]!;

    return {
      windowMinutes,
      requests: Number(row.n ?? 0),
      errors: Number(row.errors ?? 0),
      latencyP50Ms: Number(row.p50 ?? 0),
      latencyP95Ms: Number(row.p95 ?? 0),
      lifecycle: lifecycle.map((entry) => ({
        name: entry.name,
        count: Number(entry.n ?? 0),
        p50Ms: Number(entry.p50 ?? 0),
        p95Ms: Number(entry.p95 ?? 0),
      })),
    };
  },

  /** Retention: spans older than the cutoff, oldest first, in batches. */
  async sweepSpans(olderThan: string): Promise<number> {
    const rows = await db
      .delete(spans_)
      .where(lt(spans_.startedAt, new Date(olderThan)))
      .returning({ spanId: spans_.spanId });

    return rows.length;
  },

  /* ------------------------------------------------------------- audit log */

  async insertAudit(row: {
    id: string;
    at: string;
    actorKind: string;
    actorId: string | null;
    actorLabel: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    result: string;
    status: number | null;
    errorCode: string | null;
    requestId: string | null;
    ip: string | null;
    userAgent: string | null;
    durationMs: number | null;
    metadata: Record<string, unknown>;
    ownerId: string | null;
  }) {
    await db.insert(auditLog).values({ ...row, at: at(row.at)! });
  },

  async listAudit(
    filter: {
      action?: string;
      actorId?: string;
      targetType?: string;
      targetId?: string;
      result?: "ok" | "error";
      since?: string;
      until?: string;
    },
    cursor: { at: Date; id: string } | null,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const owner = scopedOwner();
    const conditions: SQL[] = [];

    if (owner) conditions.push(eq(auditLog.ownerId, owner));

    if (filter.action) conditions.push(eq(auditLog.action, filter.action));

    if (filter.actorId) conditions.push(eq(auditLog.actorId, filter.actorId));

    if (filter.targetType) conditions.push(eq(auditLog.targetType, filter.targetType));

    if (filter.targetId) conditions.push(eq(auditLog.targetId, filter.targetId));

    if (filter.result) conditions.push(eq(auditLog.result, filter.result));

    if (filter.since) conditions.push(gte(auditLog.at, new Date(filter.since)));

    if (filter.until) conditions.push(lte(auditLog.at, new Date(filter.until)));

    if (cursor) {
      conditions.push(
        or(
          lt(auditLog.at, cursor.at),
          and(eq(auditLog.at, cursor.at), lt(auditLog.id, cursor.id)),
        )!,
      );
    }

    return db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
  },

  /** Distinct actions seen, newest first — the console's filter options. */
  async auditActions(): Promise<string[]> {
    const owner = scopedOwner();
    const rows = await db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(owner ? eq(auditLog.ownerId, owner) : undefined);
    return rows.map((row) => row.action).sort();
  },

  /** Host capacity, deliberately not scoped: the limit protects this machine. */
  async totalSandboxes(): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(sandboxes);
    return Number(rows[0]?.n ?? 0);
  },
};

/** Every store method runs inside its own span (decision 0032). */
export const store = tracedStore(rawStore);
