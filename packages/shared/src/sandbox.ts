import { z } from "zod";

/**
 * Boat-compatible wire contracts.
 * Source of truth: docs/boat-openapi.yaml (`Boat Public API v1`).
 * Only the subset this product actually serves is modelled here.
 */

/**
 * Machine sizes are operator-owned rows (see /machine-sizes and decision 0034),
 * so `type` on the wire is a preset name, not a closed enum: a client may only
 * use one that exists and has not been retired.
 */
export const MACHINE_SIZE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The four presets every deployment starts with (migration 0004). Only the
 * default name is load-bearing: it is what a create without `type` gets.
 */
export const DEFAULT_MACHINE_SIZE = "default";

export const RETIRED_MACHINE_SIZE = "retired_machine_size";

export const SandboxType = z.string().regex(MACHINE_SIZE_NAME);
export type SandboxType = z.infer<typeof SandboxType>;

export const MachineSizeSchema = z.object({
  name: z.string(),
  vcpu: z.number().int(),
  memMib: z.number().int(),
  diskGb: z.number().int(),
  description: z.string().nullable(),
  retiredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MachineSize = z.infer<typeof MachineSizeSchema>;

/** Boat's `Sandbox.state` enum, verbatim and in order. */
export const SandboxState = z.enum([
  "init",
  "provisioning",
  "provisioned",
  "cloning",
  "ready",
  "idle",
  "running",
  "archiving",
  "archived",
  "error",
  "cancelled",
]);
export type SandboxState = z.infer<typeof SandboxState>;

/** Terminal / settled states used for filtering. */
export const STATES_SETTLED: SandboxState[] = ["ready", "idle", "running"];
export const STATES_STOPPED: SandboxState[] = ["archived"];

export const SANDBOX_ID = /^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;

export const SandboxSchema = z.object({
  id: z.string().regex(SANDBOX_ID),
  name: z.string(),
  state: SandboxState,
  error: z.string().nullable().optional(),
  /** Boat exposes the machine URL/IP; we expose the driver's reachable address. */
  url: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  type: SandboxType,
  labels: z.record(z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archiveAfter: z.string().datetime().nullable().optional(),
  stoppedAt: z.string().datetime().nullable().optional(),
  desktopAvailable: z.boolean().default(false),
  desktopUrl: z.string().nullable().optional(),
  snapshotAvailable: z.boolean().default(false),
  snapshotCompletedAt: z.string().datetime().nullable().optional(),
  hydrated: z.boolean().default(true),
  hydratedAt: z.string().datetime().nullable().optional(),
  runtimeId: z.string().default("local"),
});
export type Sandbox = z.infer<typeof SandboxSchema>;

const labelKey = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,62}$/;
const envKey = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const RESERVED_ENV = new Set([
  "ASCII_TOKEN",
  "ASCII_API_URL",
  "AGENT_ID",
  "PRODUCT_MODE",
  "ENVIRONMENT_ID",
  "BOAT_ID",
  "SERVICE_PREVIEW_TOKEN",
  "BOAT_CLI_TOKEN",
]);

/**
 * Files to write before the sandbox reports ready. Accepted for contract
 * conformance; not honoured — see docs/decision/0021.
 */
const CreateFileRequest = z
  .object({
    path: z.string().min(1),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  })
  .strict();

/** A port to host at create time. Accepted for conformance; not honoured. */
const CreateHostedPortRequest = z
  .object({
    port: z.number().int().min(1).max(65535),
    public: z.boolean().optional(),
    localhost: z.boolean().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();

/**
 * Boat's create schema, in full.
 *
 * Every field the spec defines is accepted, including the ones this server does
 * not act on — a client written against boat must not get `400 invalid_query`
 * for using its own API. The split is recorded in docs/decision/0021:
 *
 * Honoured: type, ttlSeconds, labels, env, name, from, setupScript.
 * Accepted and ignored: environment, noEnv, visibility, snapshots, monitoring,
 * failFast, count, hostedPorts, files, org, teamId.
 *
 * Still `.strict()`, so a genuine typo is still rejected: the difference is
 * between "boat defines this" and "nobody defines this".
 */
export const CreateSandboxRequest = z
  .object({
    type: SandboxType.default(DEFAULT_MACHINE_SIZE),
    /** `null` disables auto-stop; the spec also accepts the legacy `"infinite"`. */
    ttlSeconds: z
      .union([z.number().int().min(1).max(2592000), z.literal("infinite"), z.null()])
      .default(3600)
      .transform((value) => (value === "infinite" ? null : value)),
    name: z.string().max(120).optional(),
    labels: z
      .record(z.string().max(256))
      .refine((v) => Object.keys(v).length <= 20, { message: "at most 20 labels" })
      .refine((v) => Object.keys(v).every((k) => labelKey.test(k)), {
        message: "invalid label key",
      })
      .default({}),
    env: z
      .record(z.string().max(4096))
      .refine((v) => Object.keys(v).length <= 100, { message: "at most 100 env vars" })
      .refine((v) => Object.keys(v).every((k) => envKey.test(k) && !RESERVED_ENV.has(k)), {
        message: "invalid or reserved env key",
      })
      .default({}),
    /** Run once after ready, as the sandbox user. Output goes to the event log. */
    setupScript: z.string().max(65536).optional(),
    /**
     * Source of the new sandbox: a live sandbox id (fork its disk) or a saved
     * snapshot name (boot a new sandbox from that disk). A source that cannot
     * be used is refused; it is never a silent cold boot. Share codes are not
     * a create source (decision 0038).
     */
    from: z.string().min(1).optional(),
    /** Runtime to create on, by id or name; omitted lets the scheduler choose (decision 0042). */
    runtime: z.string().min(1).max(64).optional(),

    /* Accepted for boat parity; deliberately not acted on (docs/decision/0021). */
    environment: z.string().max(120).optional(),
    noEnv: z.boolean().optional(),
    visibility: z.enum(["private", "shared"]).optional(),
    snapshots: z.boolean().optional(),
    monitoring: z.boolean().optional(),
    failFast: z.boolean().optional(),
    count: z.number().int().min(1).max(1000).optional(),
    hostedPorts: z.array(CreateHostedPortRequest).max(50).optional(),
    files: z.array(CreateFileRequest).max(32).optional(),
    org: z.string().max(120).optional(),
    teamId: z.string().max(120).optional(),
  })
  .strict();
export type CreateSandboxRequest = z.infer<typeof CreateSandboxRequest>;

export const UpdateSandboxRequest = z
  .object({
    name: z.string().max(120).optional(),
    labels: z.record(z.string().max(256)).optional(),
    ttlSeconds: z.number().int().min(1).max(2592000).nullable().optional(),
  })
  .strict();
export type UpdateSandboxRequest = z.infer<typeof UpdateSandboxRequest>;

export const CommandRequest = z
  .object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutSeconds: z.number().int().min(1).max(600).default(30),
    detached: z.boolean().default(false),
    stream: z.boolean().default(false),
  })
  .strict();
export type CommandRequest = z.infer<typeof CommandRequest>;

export const CommandResponse = z.object({
  ok: z.literal(true),
  type: z.literal("command.finished"),
  success: z.boolean(),
  commandId: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  oomKilled: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  timedOut: z.boolean(),
  cwd: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});
export type CommandResponse = z.infer<typeof CommandResponse>;

/** JSONL frame emitted when `stream: true` (application/x-ndjson). */
export type CommandStreamFrame =
  | { type: "started"; commandId: string; startedAt: string }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | ({ type: "exit" } & Omit<CommandResponse, "ok" | "type" | "stdout" | "stderr">)
  | { type: "error"; error: string; message: string };

export const SnapshotSchema = z.object({
  id: z.string(),
  sandboxId: z.string(),
  name: z.string().nullable(),
  state: z.enum(["creating", "ready", "error"]),
  createdAt: z.string().datetime(),
  sizeBytes: z.number().int().nullable().optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const LimitsSchema = z.object({
  ok: z.literal(true),
  type: z.literal("limits"),
  limits: z.object({
    maxSandboxes: z.number().int(),
    maxSnapshots: z.number().int(),
    maxTtlSeconds: z.number().int(),
    allowedTypes: z.array(SandboxType),
  }),
  usage: z.object({
    sandboxes: z.number().int(),
    running: z.number().int(),
    snapshots: z.number().int(),
  }),
});
export type Limits = z.infer<typeof LimitsSchema>;
