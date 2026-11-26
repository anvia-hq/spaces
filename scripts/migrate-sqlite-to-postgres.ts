import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { createDb, databaseUrl } from "../packages/db/src/index.ts";

const path = process.argv[2] ?? process.env.SPACES_DB ?? "";

if (!path || !existsSync(path)) {
  console.error(
    `usage: bun run scripts/migrate-sqlite-to-postgres.ts <spaces.db>  (not found: ${path || "-"})`,
  );
  process.exit(1);
}

const sqlite = new Database(path, { readonly: true });
const handle = createDb(databaseUrl());
const client = handle.client;

const TABLES = [
  "user",
  "account",
  "session",
  "verification",
  "apikey",
  "sandboxes",
  "snapshots",
  "saved_snapshots",
  "snapshot_shares",
  "commands",
  "stops",
  "sandbox_ports",
  "events",
] as const;

const json = (value: unknown, fallback: unknown) => {
  if (typeof value !== "string" || value.length === 0) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const bool = (value: unknown) => value === 1 || value === true || value === "1";

const millis = (value: unknown) =>
  typeof value === "number" ? new Date(value) : new Date(String(value));

const ROWS: Record<string, (row: Record<string, unknown>) => Record<string, unknown>> = {
  user: (r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: bool(r.email_verified),
    image: r.image ?? null,
    createdAt: millis(r.created_at),
    updatedAt: millis(r.updated_at),
  }),
  account: (r) => ({
    id: r.id,
    accountId: r.account_id,
    providerId: r.provider_id,
    userId: r.user_id,
    accessToken: r.access_token ?? null,
    refreshToken: r.refresh_token ?? null,
    idToken: r.id_token ?? null,
    accessTokenExpiresAt:
      r.access_token_expires_at == null ? null : millis(r.access_token_expires_at),
    refreshTokenExpiresAt:
      r.refresh_token_expires_at == null ? null : millis(r.refresh_token_expires_at),
    scope: r.scope ?? null,
    password: r.password ?? null,
    createdAt: millis(r.created_at),
    updatedAt: millis(r.updated_at),
  }),
  session: (r) => ({
    id: r.id,
    expiresAt: millis(r.expires_at),
    token: r.token,
    createdAt: millis(r.created_at),
    updatedAt: millis(r.updated_at),
    ipAddress: r.ip_address ?? null,
    userAgent: r.user_agent ?? null,
    userId: r.user_id,
  }),
  verification: (r) => ({
    id: r.id,
    identifier: r.identifier,
    value: r.value,
    expiresAt: millis(r.expires_at),
    createdAt: millis(r.created_at),
    updatedAt: millis(r.updated_at),
  }),
  apikey: (r) => ({
    id: r.id,
    configId: r.config_id,
    name: r.name ?? null,
    start: r.start ?? null,
    referenceId: r.reference_id,
    prefix: r.prefix ?? null,
    key: r.key,
    refillInterval: r.refill_interval ?? null,
    refillAmount: r.refill_amount ?? null,
    lastRefillAt: r.last_refill_at == null ? null : millis(r.last_refill_at),
    enabled: r.enabled == null ? null : bool(r.enabled),
    rateLimitEnabled: r.rate_limit_enabled == null ? null : bool(r.rate_limit_enabled),
    rateLimitTimeWindow: r.rate_limit_time_window ?? null,
    rateLimitMax: r.rate_limit_max ?? null,
    requestCount: r.request_count ?? null,
    remaining: r.remaining ?? null,
    lastRequest: r.last_request == null ? null : millis(r.last_request),
    expiresAt: r.expires_at == null ? null : millis(r.expires_at),
    createdAt: millis(r.created_at),
    updatedAt: millis(r.updated_at),
    permissions: json(r.permissions, null),
    metadata: json(r.metadata, null),
  }),
  sandboxes: (r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    type: r.type,
    labels: json(r.labels, {}),
    env: json(r.env, {}),
    error: r.error ?? null,
    url: r.url ?? null,
    ip: r.ip ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    stoppedAt: r.stopped_at ?? null,
    archiveAfter: r.archive_after ?? null,
    ttlSeconds: r.ttl_seconds ?? null,
    snapshotAt: r.snapshot_at ?? null,
    forkOf: r.fork_of ?? null,
    driverRef: r.driver_ref ?? null,
    hydrated: bool(r.hydrated),
    hydratedAt: r.hydrated_at ?? null,
    ownerId: r.owner_id ?? null,
  }),
  snapshots: (r) => ({
    id: r.id,
    sandboxId: r.sandbox_id,
    name: r.name ?? null,
    state: r.state,
    createdAt: r.created_at,
    sizeBytes: r.size_bytes ?? null,
    driverRef: r.driver_ref ?? null,
    manifest: json(r.manifest, null),
    ownerId: r.owner_id ?? null,
  }),
  saved_snapshots: (r) => ({
    name: r.name,
    status: r.status,
    error: r.error ?? null,
    sourceSandboxId: r.source_sandbox_id,
    snapshotId: r.snapshot_id ?? null,
    type: r.type ?? null,
    sizeBytes: r.size_bytes ?? null,
    createdAt: r.created_at,
    ownerId: r.owner_id ?? null,
  }),
  snapshot_shares: (r) => ({
    id: r.id,
    name: r.name,
    codeHash: r.code_hash,
    codePrefix: r.code_prefix,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at ?? null,
    revokedAt: r.revoked_at ?? null,
    createdAt: r.created_at,
  }),
  commands: (r) => ({
    id: r.id,
    sandboxId: r.sandbox_id,
    command: r.command,
    cwd: r.cwd ?? null,
    pid: r.pid ?? null,
    mode: r.mode,
    killed: bool(r.killed),
    exitCode: r.exit_code ?? null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut: r.timed_out ?? 0,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
  }),
  stops: (r) => ({
    id: r.id,
    sandboxId: r.sandbox_id,
    status: r.status,
    requestedAt: r.requested_at ?? null,
    lastAttemptAt: r.last_attempt_at ?? null,
    error: r.error ?? null,
    endedAt: r.ended_at ?? null,
    forced: bool(r.forced),
  }),
  sandbox_ports: (r) => ({
    id: r.id,
    sandboxId: r.sandbox_id,
    guestPort: r.guest_port,
    hostPort: r.host_port,
    bind: r.bind,
    title: r.title ?? null,
    public: bool(r.public),
    localhost: bool(r.localhost),
    explicit: bool(r.explicit),
    createdAt: r.created_at,
  }),
  events: (r) => ({
    id: r.id,
    sandboxId: r.sandbox_id,
    type: r.type,
    payload: json(r.payload, {}),
    at: r.at,
  }),
};

async function main() {
  const existing = sqlite.query("select name from sqlite_master where type = 'table'").all() as {
    name: string;
  }[];
  const present = new Set(existing.map((t) => t.name));

  console.log(`source    ${path}`);
  console.log(`tables    ${TABLES.filter((t) => present.has(t)).length} of ${TABLES.length}`);

  await handle.migrate();

  for (const table of TABLES) {
    const rows = await client.unsafe(`select count(*)::int as n from "${table}"`);

    if (Number(rows[0]?.n ?? 0) > 0) {
      throw new Error(
        `target already has rows in "${table}"; refusing to merge two databases. Point SPACES_DATABASE_URL at an empty database.`,
      );
    }
  }

  const counts = new Map<string, number>();

  for (const table of TABLES) {
    if (!present.has(table)) {
      counts.set(table, 0);
      continue;
    }

    const source = sqlite.query(`select * from "${table}"`).all() as Record<string, unknown>[];
    const rows = source.map(ROWS[table]);
    counts.set(table, rows.length);

    const CHUNK = 200;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const keys = Object.keys(batch[0]!);
      const values: unknown[] = [];
      const placeholders = batch.map((row) => {
        values.push(...keys.map((k) => row[k]));
        return `(${keys.map((_, c) => `$${values.length - keys.length + c + 1}`).join(", ")})`;
      });

      const columns = keys.map((k) => `"${snake(k)}"`).join(", ");
      await client.unsafe(
        `insert into "${table}" (${columns}) values ${placeholders.join(", ")}`,
        values as never[],
      );
    }

    console.log(`copied    ${table.padEnd(18)} ${rows.length}`);
  }

  await client.unsafe(
    `select setval(pg_get_serial_sequence('events', 'id'), coalesce(max(id), 1), max(id) is not null) from events`,
  );

  let mismatch = 0;

  for (const table of TABLES) {
    const rows = await client.unsafe(`select count(*)::int as n from "${table}"`);
    const target = Number(rows[0]?.n ?? 0);
    const source = counts.get(table) ?? 0;

    if (source !== target) {
      mismatch += 1;
      console.error(`MISMATCH  ${table}: ${source} in, ${target} out`);
    }
  }

  if (mismatch > 0)
    throw new Error(`${mismatch} table(s) did not match; the SQLite file is untouched`);

  console.log(`verified  ${TABLES.length} tables, every row accounted for`);
  console.log(`users     ${await count("user")}, sandboxes ${await count("sandboxes")}`);

  async function count(table: string) {
    const rows = await client.unsafe(`select count(*)::int as n from "${table}"`);
    return Number(rows[0]?.n ?? 0);
  }
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

try {
  await main();
} finally {
  sqlite.close();
  await handle.close();
}
