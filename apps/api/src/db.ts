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
  idempotencyKeys,
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
  runtimes,
  type RuntimeRow,
  type RuntimeSampleRow,
  runtimeSamples,
  notInArray,
  type SandboxPortRow,
  type SandboxRow,
  type SavedSnapshotRow,
  type SnapshotRow,
  type AuditLogRow,
  type StopRow,
  auditLog,
  type SQL,
} from "@spaces/db";
import {
  STATES_STOPPED,
  type NetworkPolicy,
  type Sandbox,
  type SandboxState,
  type SandboxType,
  type SetupStatus,
} from "@spaces/shared/sandbox";
import { LOCAL_RUNTIME_ID } from "@spaces/shared/runtime";
import type { RuntimeLoad } from "./modules/runtimes/types.ts";
import { config } from "./config.ts";
import { canSee, currentOwnerId, scopedOwner } from "./scope.ts";
import { tracedStore } from "./modules/traces/proxies.ts";

export type { RuntimeSampleRow, SavedSnapshotRow } from "@spaces/db";

const handle = createDb(config.databaseUrl);
export const db = handle.db;

await handle.migrate();

export type { CommandRow, RuntimeRow, SandboxRow, SnapshotRow };

export const now = () => new Date().toISOString();

export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const at = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

export async function one<T>(query: PromiseLike<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

export type SandboxSort = "createdAt:desc" | "createdAt:asc" | "updatedAt:desc";

export interface ListFilter {
  states?: SandboxState[];
  name?: string;
  namePrefix?: string;
  labels?: string[];
  stoppedBefore?: string;
  sort?: SandboxSort;
  limit?: number;
  cursor?: { at: Date; id: string };
}

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
    snapshotAvailable: row.snapshotAt !== null,
    snapshotCompletedAt: iso(row.snapshotAt),
    hydrated: row.hydrated,
    hydratedAt: iso(row.hydratedAt),
    setupStatus: row.setupStatus ?? null,
    setupError: row.setupError ?? null,
    network: row.networkPolicy ?? null,
    runtimeId: row.runtimeId,
  };
}

const ACTIVE_STATES: SandboxState[] = [
  "init",
  "provisioning",
  "provisioned",
  "cloning",
  "ready",
  "idle",
  "running",
  "archiving",
];

const rawStore = {
  async list(filter: ListFilter = {}): Promise<Sandbox[]> {
    const { sandboxes: items } = await this.listPage(filter);
    return items;
  },

  async listPage(
    filter: ListFilter = {},
  ): Promise<{ sandboxes: Sandbox[]; nextCursor: string | null }> {
    const where: SQL[] = [];
    const owner = scopedOwner();
    const sort: SandboxSort = filter.sort ?? "createdAt:desc";

    if (owner) where.push(eq(sandboxes.ownerId, owner));

    if (filter.states?.length) where.push(inArray(sandboxes.state, filter.states));

    if (filter.name !== undefined) where.push(eq(sandboxes.name, filter.name));

    if (filter.namePrefix !== undefined) where.push(like(sandboxes.name, `${filter.namePrefix}%`));

    if (filter.stoppedBefore !== undefined) {
      where.push(
        inArray(sandboxes.state, STATES_STOPPED),
        lt(sandboxes.stoppedAt, new Date(filter.stoppedBefore)),
      );
    }

    for (const raw of filter.labels ?? []) {
      const idx = raw.indexOf("=");
      const key = idx === -1 ? raw : raw.slice(0, idx);
      const value = idx === -1 ? "" : raw.slice(idx + 1);
      where.push(sql`${sandboxes.labels} @> ${JSON.stringify({ [key]: value })}::jsonb`);
    }

    const orderColumn = sort === "updatedAt:desc" ? sandboxes.updatedAt : sandboxes.createdAt;
    const ascending = sort === "createdAt:asc";

    if (filter.cursor) {
      const { at: cursorAt, id: cursorId } = filter.cursor;
      where.push(
        ascending
          ? or(
              gt(orderColumn, cursorAt),
              and(eq(orderColumn, cursorAt), gt(sandboxes.id, cursorId)),
            )!
          : or(
              lt(orderColumn, cursorAt),
              and(eq(orderColumn, cursorAt), lt(sandboxes.id, cursorId)),
            )!,
      );
    }

    const query = db
      .select()
      .from(sandboxes)
      .where(where.length ? and(...where) : undefined)
      .orderBy(
        ascending ? asc(orderColumn) : desc(orderColumn),
        ascending ? asc(sandboxes.id) : desc(sandboxes.id),
      );

    const rows = filter.limit ? await query.limit(filter.limit + 1) : await query;
    const items = rows.map(toSandbox);

    if (!filter.limit) {
      return { sandboxes: items, nextCursor: null };
    }

    const hasMore = items.length > filter.limit;
    const page = hasMore ? items.slice(0, filter.limit) : items;
    const tail = page[page.length - 1];
    const nextCursor =
      hasMore && tail
        ? `${sort === "updatedAt:desc" ? tail.updatedAt : tail.createdAt}|${tail.id}`
        : null;

    return { sandboxes: page, nextCursor };
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
    runtimeId?: string;
    setupStatus?: SetupStatus | null;
    networkPolicy?: NetworkPolicy | null;
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
      runtimeId: s.runtimeId ?? LOCAL_RUNTIME_ID,
      setupStatus: s.setupStatus ?? null,
      networkPolicy: s.networkPolicy ?? null,
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
      env: Record<string, string>;
      stoppedAt: string | null;
      archiveAfter: string | null;
      snapshotAt: string | null;
      driverRef: string | null;
      hydrated: boolean;
      hydratedAt: string | null;
      setupStatus: SetupStatus | null;
      setupError: string | null;
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
      env?: Record<string, string>;
      driverRef?: string | null;
      hydrated?: boolean;
      setupStatus?: SetupStatus | null;
      setupError?: string | null;
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

    if (patch.env !== undefined) values.env = patch.env;

    if (patch.driverRef !== undefined) values.driverRef = patch.driverRef;

    if (patch.hydrated !== undefined) values.hydrated = patch.hydrated;

    if (patch.setupStatus !== undefined) values.setupStatus = patch.setupStatus;

    if (patch.setupError !== undefined) values.setupError = patch.setupError;

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

  async countOfType(type: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(eq(sandboxes.type, type));
    return Number(rows[0]?.n ?? 0);
  },

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
    runtimeId?: string;
  }) {
    await db.insert(snapshots).values({
      id: s.id,
      sandboxId: s.sandboxId,
      name: s.name,
      state: s.state,
      createdAt: at(now())!,
      sizeBytes: s.sizeBytes ?? null,
      driverRef: s.driverRef ?? null,
      runtimeId: s.runtimeId ?? LOCAL_RUNTIME_ID,
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

  async commandById(id: string): Promise<CommandRow | null> {
    const row = await one(db.select().from(commands).where(eq(commands.id, id)));
    return row && (await this.raw(row.sandboxId)) ? row : null;
  },

  async markCommandKilled(id: string) {
    await db.update(commands).set({ killed: true }).where(eq(commands.id, id));
  },

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

  async allHostPorts(runtimeId: string): Promise<number[]> {
    const rows = await db
      .select({ hostPort: sandboxPorts.hostPort })
      .from(sandboxPorts)
      .innerJoin(sandboxes, eq(sandboxes.id, sandboxPorts.sandboxId))
      .where(eq(sandboxes.runtimeId, runtimeId));
    return rows.map((r) => r.hostPort);
  },

  async runtimeIdOf(sandboxId: string): Promise<string | null> {
    const row = await one(
      db
        .select({ runtimeId: sandboxes.runtimeId })
        .from(sandboxes)
        .where(eq(sandboxes.id, sandboxId)),
    );
    return row?.runtimeId ?? null;
  },

  async runtimeIdOfSnapshot(snapshotId: string): Promise<string | null> {
    const row = await one(
      db
        .select({ runtimeId: snapshots.runtimeId })
        .from(snapshots)
        .where(eq(snapshots.id, snapshotId)),
    );
    return row?.runtimeId ?? null;
  },

  async listRuntimes(): Promise<RuntimeRow[]> {
    return db.select().from(runtimes).orderBy(asc(runtimes.name));
  },

  async getRuntime(id: string): Promise<RuntimeRow | null> {
    return one(db.select().from(runtimes).where(eq(runtimes.id, id)));
  },

  async runtimeByName(name: string): Promise<RuntimeRow | null> {
    return one(db.select().from(runtimes).where(eq(runtimes.name, name)));
  },

  async runtimeByTokenHash(tokenHash: string): Promise<RuntimeRow | null> {
    return one(db.select().from(runtimes).where(eq(runtimes.tokenHash, tokenHash)));
  },

  async insertRuntime(r: {
    id: string;
    name: string;
    kind: "local" | "agent";
    state?: "online" | "offline";
    labels?: Record<string, string>;
    maxSandboxes?: number | null;
    tokenHash?: string | null;
    tokenPrefix?: string | null;
    driverKind?: string | null;
    capabilities?: RuntimeRow["capabilities"];
    vcpu?: number | null;
    memMib?: number | null;
    portStart?: number | null;
    portEnd?: number | null;
    portBind?: string | null;
    publicHost?: string | null;
  }) {
    const ts = at(now())!;
    await db
      .insert(runtimes)
      .values({
        id: r.id,
        name: r.name,
        kind: r.kind,
        state: r.state ?? "offline",
        labels: r.labels ?? {},
        maxSandboxes: r.maxSandboxes ?? null,
        tokenHash: r.tokenHash ?? null,
        tokenPrefix: r.tokenPrefix ?? null,
        driverKind: r.driverKind ?? null,
        capabilities: r.capabilities ?? null,
        vcpu: r.vcpu ?? null,
        memMib: r.memMib ?? null,
        portStart: r.portStart ?? null,
        portEnd: r.portEnd ?? null,
        portBind: r.portBind ?? null,
        publicHost: r.publicHost ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .onConflictDoNothing({ target: runtimes.id });
  },

  async updateRuntime(
    id: string,
    patch: Partial<{
      name: string;
      state: "online" | "offline";
      draining: boolean;
      labels: Record<string, string>;
      maxSandboxes: number | null;
      tokenHash: string | null;
      tokenPrefix: string | null;
      driverKind: string | null;
      capabilities: RuntimeRow["capabilities"];
      vcpu: number | null;
      memMib: number | null;
      portStart: number | null;
      portEnd: number | null;
      portBind: string | null;
      publicHost: string | null;
      agentVersion: string | null;
      protocol: number | null;
      connectedAt: string | null;
      lastSeenAt: string | null;
    }>,
  ) {
    const { connectedAt, lastSeenAt, ...rest } = patch;
    const values: Partial<typeof runtimes.$inferInsert> = { ...rest, updatedAt: at(now())! };

    if (connectedAt !== undefined) values.connectedAt = at(connectedAt);

    if (lastSeenAt !== undefined) values.lastSeenAt = at(lastSeenAt);

    await db.update(runtimes).set(values).where(eq(runtimes.id, id));
  },

  async deleteRuntime(id: string) {
    await db.delete(runtimes).where(eq(runtimes.id, id));
  },

  async markRuntimesOffline(except: string[]) {
    const where = except.length
      ? and(
          eq(runtimes.kind, "agent"),
          eq(runtimes.state, "online"),
          notInArray(runtimes.id, except),
        )
      : and(eq(runtimes.kind, "agent"), eq(runtimes.state, "online"));
    await db
      .update(runtimes)
      .set({ state: "offline", updatedAt: at(now())! })
      .where(where);
  },

  async insertRuntimeSamples(rows: RuntimeSampleRow[]): Promise<void> {
    if (rows.length === 0) return;

    await db.insert(runtimeSamples).values(rows).onConflictDoNothing();
  },

  async runtimeSamplesSince(since: Date, runtimeId?: string): Promise<RuntimeSampleRow[]> {
    const where = runtimeId
      ? and(gte(runtimeSamples.at, since), eq(runtimeSamples.runtimeId, runtimeId))
      : gte(runtimeSamples.at, since);

    return db.select().from(runtimeSamples).where(where).orderBy(asc(runtimeSamples.at));
  },

  async sweepRuntimeSamples(olderThan: Date): Promise<number> {
    const rows = await db
      .delete(runtimeSamples)
      .where(lt(runtimeSamples.at, olderThan))
      .returning({ runtimeId: runtimeSamples.runtimeId });

    return rows.length;
  },

  async runtimeLoad(): Promise<Map<string, RuntimeLoad>> {
    const load = new Map<string, RuntimeLoad>();
    const entry = (id: string) => {
      let value = load.get(id);

      if (!value) {
        value = { active: 0, total: 0, snapshots: 0, vcpu: 0, memMib: 0 };
        load.set(id, value);
      }

      return value;
    };
    const live = inArray(sandboxes.state, ACTIVE_STATES);
    const sandboxRows = await db
      .select({
        runtimeId: sandboxes.runtimeId,
        active: sql<number>`count(*) filter (where ${live})::int`,
        total: sql<number>`count(*)::int`,
        vcpu: sql<number>`coalesce(sum(${machineSizes.vcpu}) filter (where ${live}), 0)::int`,
        memMib: sql<number>`coalesce(sum(${machineSizes.memMib}) filter (where ${live}), 0)::int`,
      })
      .from(sandboxes)
      .leftJoin(machineSizes, eq(machineSizes.name, sandboxes.type))
      .groupBy(sandboxes.runtimeId);

    for (const row of sandboxRows) {
      const value = entry(row.runtimeId);
      value.active = Number(row.active);
      value.total = Number(row.total);
      value.vcpu = Number(row.vcpu);
      value.memMib = Number(row.memMib);
    }

    const snapshotRows = await db
      .select({ runtimeId: snapshots.runtimeId, n: sql<number>`count(*)::int` })
      .from(snapshots)
      .groupBy(snapshots.runtimeId);

    for (const row of snapshotRows) entry(row.runtimeId).snapshots = Number(row.n);

    return load;
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

  async getIdempotencyKey(key: string): Promise<string | null> {
    const row = await one(
      db
        .select({ sandboxId: idempotencyKeys.sandboxId, expiresAt: idempotencyKeys.expiresAt })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key)),
    );

    if (!row || row.expiresAt.getTime() <= Date.now()) return null;

    return row.sandboxId;
  },

  async putIdempotencyKey(key: string, sandboxId: string, expiresAt: Date) {
    await db
      .insert(idempotencyKeys)
      .values({ key, sandboxId, createdAt: new Date(), expiresAt })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: { sandboxId, expiresAt },
      });
  },

  async insertSandboxIdempotent(
    key: string,
    expiresAt: Date,
    s: {
      id: string;
      name: string;
      state: SandboxState;
      type: SandboxType;
      labels?: Record<string, string>;
      env?: Record<string, string>;
      ttlSeconds?: number | null;
      archiveAfter?: string | null;
      forkOf?: string | null;
      driverRef?: string | null;
      hydrated?: boolean;
      runtimeId?: string;
      setupStatus?: SetupStatus | null;
      setupError?: string | null;
      networkPolicy?: NetworkPolicy | null;
    },
  ): Promise<{ created: true } | { created: false; sandbox: Sandbox }> {
    const ownerId = currentOwnerId();
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const existingKey = await one(
        tx
          .select({ sandboxId: idempotencyKeys.sandboxId, expiresAt: idempotencyKeys.expiresAt })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.key, key)),
      );

      if (existingKey && existingKey.expiresAt.getTime() > Date.now()) {
        const existingRow = await one(
          tx.select().from(sandboxes).where(eq(sandboxes.id, existingKey.sandboxId)),
        );

        if (existingRow && canSee(existingRow.ownerId)) {
          return { created: false as const, sandbox: toSandbox(existingRow) };
        }
      }

      const timestamp = new Date();
      await tx.insert(sandboxes).values({
        id: s.id,
        name: s.name,
        state: s.state,
        type: s.type,
        labels: s.labels ?? {},
        env: s.env ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        archiveAfter: at(s.archiveAfter),
        ttlSeconds: s.ttlSeconds ?? null,
        forkOf: s.forkOf ?? null,
        driverRef: s.driverRef ?? null,
        hydrated: s.hydrated ?? true,
        ownerId,
        runtimeId: s.runtimeId ?? LOCAL_RUNTIME_ID,
        setupStatus: s.setupStatus ?? null,
        setupError: s.setupError ?? null,
        networkPolicy: s.networkPolicy ?? null,
      });

      await tx
        .insert(idempotencyKeys)
        .values({ key, sandboxId: s.id, createdAt: timestamp, expiresAt })
        .onConflictDoUpdate({
          target: idempotencyKeys.key,
          set: { sandboxId: s.id, expiresAt },
        });

      return { created: true as const };
    });
  },

  async sweepIdempotencyKeys(cutoff: Date): Promise<number> {
    const rows = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, cutoff))
      .returning({ key: idempotencyKeys.key });

    return rows.length;
  },

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

  async pendingStop(sandboxId: string): Promise<StopRow | null> {
    return one(
      db
        .select()
        .from(stops)
        .where(and(eq(stops.sandboxId, sandboxId), inArray(stops.status, ["pending", "failing"])))
        .orderBy(desc(stops.requestedAt)),
    );
  },

  async allEvents(sandboxId: string): Promise<EventRow[]> {
    if (!(await this.raw(sandboxId))) return [];

    return db.select().from(events).where(eq(events.sandboxId, sandboxId)).orderBy(asc(events.id));
  },

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

  async sweepSpans(olderThan: string): Promise<number> {
    const rows = await db
      .delete(spans_)
      .where(lt(spans_.startedAt, new Date(olderThan)))
      .returning({ spanId: spans_.spanId });

    return rows.length;
  },

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

  async auditActions(): Promise<string[]> {
    const owner = scopedOwner();
    const rows = await db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(owner ? eq(auditLog.ownerId, owner) : undefined);
    return rows.map((row) => row.action).sort();
  },

  async totalSandboxes(): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(sandboxes);
    return Number(rows[0]?.n ?? 0);
  },
};

export const store = tracedStore(rawStore);
