import { z } from "zod";
import { FILE_INLINE_LIMIT, FileEncoding, resolveSandboxPath } from "./files.ts";

export const CREATE_FILES_TOTAL_LIMIT = 20 * 1024 * 1024;

export const SetupStatus = z.enum(["pending", "running", "done", "failed"]);
export type SetupStatus = z.infer<typeof SetupStatus>;

export const NetworkMode = z.enum(["default", "open", "deny", "allow"]);
export type NetworkMode = z.infer<typeof NetworkMode>;

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const IPV6_RE = /^[0-9a-fA-F:]+(?:\/(\d{1,3}))?$/;

function parseIpv4(
  input: string,
): { parts: [number, number, number, number]; prefix: number } | null {
  const match = IPV4_RE.exec(input);

  if (!match) return null;

  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];

  if (octets.some((n) => n > 255)) return null;

  const prefix = match[5] === undefined ? 32 : Number(match[5]);

  if (prefix > 32) return null;

  return { parts: octets as [number, number, number, number], prefix };
}

function ipv4ToUint32([a, b, c, d]: [number, number, number, number]): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4RangeOverlaps(
  parts: [number, number, number, number],
  prefix: number,
  netParts: [number, number, number, number],
  netPrefix: number,
): boolean {
  const minPrefix = Math.min(prefix, netPrefix);

  if (minPrefix === 0) return true;

  const mask = (0xffffffff << (32 - minPrefix)) >>> 0;
  return (ipv4ToUint32(parts) & mask) === (ipv4ToUint32(netParts) & mask);
}

const RESERVED_IPV4: [[number, number, number, number], number][] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

function isPrivateIpv6(input: string): boolean {
  const [addr, prefixRaw] = input.toLowerCase().split("/");

  if (!addr || !addr.includes(":")) return true;

  if (prefixRaw !== undefined) {
    const prefix = Number(prefixRaw);

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return true;

    if (prefix === 0) return true;
  }

  if (addr === "::" || addr === "::1" || addr.startsWith("::ffff:")) return true;

  const first = addr.split(":")[0] ?? "";
  const head = Number.parseInt(first || "0", 16);

  if (Number.isNaN(head)) return true;

  if ((head & 0xfe00) === 0xfc00) return true;

  if ((head & 0xffc0) === 0xfe80) return true;

  if ((head & 0xff00) === 0xff00) return true;

  return false;
}

export function isPrivateIpOrCidr(entry: string): boolean {
  const v4 = parseIpv4(entry);

  if (v4) {
    return RESERVED_IPV4.some(([net, pfx]) => ipv4RangeOverlaps(v4.parts, v4.prefix, net, pfx));
  }

  if (entry.includes(":")) return isPrivateIpv6(entry);

  return false;
}

export function classifyNetworkEntry(raw: string): "domain" | "ip" | null {
  const entry = raw.trim().toLowerCase();

  if (!entry || entry.length > 255 || /\s/.test(entry)) return null;

  if (parseIpv4(entry)) return "ip";

  if (entry.includes(":")) {
    const match = IPV6_RE.exec(entry);

    if (!match) return null;

    if (match[1] !== undefined && Number(match[1]) > 128) return null;

    return "ip";
  }

  const target = entry.startsWith("*.") ? entry.slice(2) : entry;
  const labels = target.split(".");

  if (labels.length < 2) return null;

  if (labels.some((label) => !DOMAIN_LABEL.test(label))) return null;

  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;

  return "domain";
}

const NetworkAllowEntry = z
  .string()
  .min(1)
  .max(255)
  .transform((value) => value.trim().toLowerCase())
  .superRefine((entry, ctx) => {
    const kind = classifyNetworkEntry(entry);

    if (!kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid network entry '${entry}': use a domain, *.domain, or public IP/CIDR`,
      });
      return;
    }

    if (kind === "ip" && isPrivateIpOrCidr(entry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `private or reserved IP/CIDR '${entry}' is not allowed in per-sandbox policies`,
      });
    }
  });

export const NetworkPolicySchema = z
  .object({
    mode: NetworkMode,
    allow: z.array(NetworkAllowEntry).max(100).default([]),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.mode === "allow" && policy.allow.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allow"],
        message: "mode 'allow' requires at least one entry",
      });
    }

    if (policy.mode !== "allow" && policy.allow.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allow"],
        message: "allow entries are only valid when mode is 'allow'",
      });
    }
  });
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

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
  url: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  type: SandboxType,
  labels: z.record(z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archiveAfter: z.string().datetime().nullable().optional(),
  stoppedAt: z.string().datetime().nullable().optional(),
  snapshotAvailable: z.boolean().default(false),
  snapshotCompletedAt: z.string().datetime().nullable().optional(),
  hydrated: z.boolean().default(true),
  hydratedAt: z.string().datetime().nullable().optional(),
  setupStatus: SetupStatus.nullable().optional(),
  setupError: z.string().nullable().optional(),
  network: NetworkPolicySchema.nullable().optional(),
  runtimeId: z.string().default("local"),
});
export type Sandbox = z.infer<typeof SandboxSchema>;

const labelKey = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,62}$/;
const envKey = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const LabelsSchema = z
  .record(z.string().max(256))
  .refine((v) => Object.keys(v).length <= 20, { message: "at most 20 labels" })
  .refine((v) => Object.keys(v).every((k) => labelKey.test(k)), {
    message: "invalid label key",
  });

const EnvSchema = z
  .record(z.string().max(4096))
  .refine((v) => Object.keys(v).length <= 100, { message: "at most 100 env vars" })
  .refine((v) => Object.keys(v).every((k) => envKey.test(k)), {
    message: "invalid env key",
  });

const utf8Encoder = new TextEncoder();

function fileByteLength(content: string, encoding: "utf8" | "base64"): number {
  if (encoding === "utf8") return utf8Encoder.encode(content).byteLength;

  const stripped = content.replace(/\s+/g, "");
  let padding = 0;

  if (stripped.endsWith("==")) padding = 2;
  else if (stripped.endsWith("=")) padding = 1;

  return Math.max(0, Math.floor((stripped.length * 3) / 4) - padding);
}

const createFilePath = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const resolved = resolveSandboxPath(value);

    if (!resolved.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_path: must resolve under /home/user or /tmp",
      });
      return z.NEVER;
    }

    return resolved.path;
  });

export const CreateFileRequest = z
  .object({
    path: createFilePath,
    content: z.string(),
    encoding: FileEncoding.default("utf8"),
  })
  .strict()
  .refine((file) => fileByteLength(file.content, file.encoding) <= FILE_INLINE_LIMIT, {
    message: `file exceeds ${FILE_INLINE_LIMIT} byte inline limit`,
  });
export type CreateFileRequest = z.infer<typeof CreateFileRequest>;

export const CreateHostedPortRequest = z
  .object({
    port: z.number().int().min(1).max(65535),
    public: z.boolean().optional(),
    localhost: z.boolean().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();
export type CreateHostedPortRequest = z.infer<typeof CreateHostedPortRequest>;

export const CreateSandboxRequest = z
  .object({
    type: SandboxType.default(DEFAULT_MACHINE_SIZE),
    ttlSeconds: z.number().int().min(1).max(2592000).nullable().default(3600),
    name: z.string().max(120).optional(),
    labels: LabelsSchema.default({}),
    env: EnvSchema.default({}),
    setupScript: z.string().max(65536).optional(),
    from: z.string().min(1).optional(),
    runtime: z.string().min(1).max(64).optional(),
    hostedPorts: z.array(CreateHostedPortRequest).max(50).optional(),
    files: z
      .array(CreateFileRequest)
      .max(32)
      .refine(
        (items) =>
          items.reduce((sum, item) => sum + fileByteLength(item.content, item.encoding), 0) <=
          CREATE_FILES_TOTAL_LIMIT,
        { message: `total files exceed ${CREATE_FILES_TOTAL_LIMIT} byte limit` },
      )
      .optional(),
    wait: z.boolean().default(false),
    waitTimeoutSeconds: z.number().int().min(1).max(120).default(30),
    network: NetworkPolicySchema.optional(),
  })
  .strict();
export type CreateSandboxRequest = z.infer<typeof CreateSandboxRequest>;

export const UpdateSandboxRequest = z
  .object({
    name: z.string().max(120).optional(),
    labels: LabelsSchema.nullable().optional(),
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
