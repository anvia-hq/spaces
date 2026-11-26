import { z } from "zod";
import { FILE_INLINE_LIMIT, FileEncoding, SANDBOX_ROOTS, sandboxPath } from "./files.ts";

export const CREATE_FILES_TOTAL_LIMIT = 20 * 1024 * 1024;

export const SetupStatus = z.enum(["pending", "running", "done", "failed"]);
export type SetupStatus = z.infer<typeof SetupStatus>;

export const NetworkMode = z.enum(["default", "open", "deny", "allow"]);
export type NetworkMode = z.infer<typeof NetworkMode>;

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE =
  /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:\/(0|[1-9]\d?))?$/;
const IPV6_PREFIX_RE = /^(?:0|[1-9]\d{0,2})$/;
const IPV6_GROUP_RE = /^[0-9a-f]{1,4}$/;

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

function parseIpv6Side(side: string, allowEmbeddedV4: boolean): number[] | null {
  if (side === "") return [];

  const tokens = side.split(":");
  const groups: number[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (!token) return null;

    if (token.includes(".")) {
      if (!allowEmbeddedV4 || i !== tokens.length - 1 || token.includes("/")) return null;

      const v4 = parseIpv4(token);

      if (!v4) return null;

      const [a, b, c, d] = v4.parts;
      groups.push((a << 8) | b, (c << 8) | d);
      continue;
    }

    if (!IPV6_GROUP_RE.test(token)) return null;

    groups.push(Number.parseInt(token, 16));
  }

  return groups;
}

function parseIpv6(input: string): { value: bigint; prefix: number } | null {
  const slashParts = input.split("/");

  if (slashParts.length > 2) return null;

  const addr = slashParts[0]!;
  const prefixRaw = slashParts[1];

  if (!addr || !addr.includes(":")) return null;

  let prefix = 128;

  if (prefixRaw !== undefined) {
    if (!IPV6_PREFIX_RE.test(prefixRaw)) return null;

    prefix = Number(prefixRaw);

    if (prefix > 128) return null;
  }

  const halves = addr.split("::");

  if (halves.length > 2) return null;

  let groups: number[];

  if (halves.length === 1) {
    const parsed = parseIpv6Side(halves[0]!, true);

    if (!parsed || parsed.length !== 8) return null;

    groups = parsed;
  } else {
    const left = parseIpv6Side(halves[0]!, false);
    const right = parseIpv6Side(halves[1]!, true);

    if (!left || !right || left.length + right.length >= 8) return null;

    const missing = 8 - left.length - right.length;
    groups = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  }

  let value = 0n;

  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }

  return { value, prefix };
}

function ipv6RangeOverlaps(a: bigint, aPrefix: number, b: bigint, bPrefix: number): boolean {
  const minPrefix = Math.min(aPrefix, bPrefix);

  if (minPrefix === 0) return true;

  const shift = BigInt(128 - minPrefix);
  return a >> shift === b >> shift;
}

const RESERVED_GLOBAL_IPV6: [bigint, number][] = [
  [0x20010000000000000000000000000000n, 32],
  [0x20010002000000000000000000000000n, 48],
  [0x20010010000000000000000000000000n, 28],
  [0x20010020000000000000000000000000n, 28],
  [0x20010db8000000000000000000000000n, 32],
  [0x20020000000000000000000000000000n, 16],
  [0x3fff0000000000000000000000000000n, 20],
];

function isPrivateIpv6(input: string): boolean {
  const parsed = parseIpv6(input.trim().toLowerCase());

  if (!parsed) return true;

  if (parsed.prefix < 3) return true;

  if (parsed.value >> 125n !== 1n) return true;

  return RESERVED_GLOBAL_IPV6.some(([net, pfx]) =>
    ipv6RangeOverlaps(parsed.value, parsed.prefix, net, pfx),
  );
}

export function isPrivateIpOrCidr(entry: string): boolean {
  const normalized = entry.trim().toLowerCase();
  const v4 = parseIpv4(normalized);

  if (v4) {
    return RESERVED_IPV4.some(([net, pfx]) => ipv4RangeOverlaps(v4.parts, v4.prefix, net, pfx));
  }

  if (normalized.includes(":")) return isPrivateIpv6(normalized);

  return false;
}

export function classifyNetworkEntry(raw: string): "domain" | "ip" | null {
  const entry = raw.trim().toLowerCase();

  if (!entry || entry.length > 255 || /\s/.test(entry)) return null;

  if (parseIpv4(entry)) return "ip";

  if (entry.includes(":")) return parseIpv6(entry) ? "ip" : null;

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

export const MACHINE_SIZE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

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
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64_RAW_CHARS = Math.ceil((FILE_INLINE_LIMIT * 4) / 3) + 200_000;

function isValidBase64(content: string): boolean {
  if (content.length > MAX_BASE64_RAW_CHARS) return false;

  const stripped = content.replace(/[\r\n]+/g, "");

  if (content.length - stripped.length > stripped.length) return false;

  if (!BASE64_RE.test(stripped)) return false;

  if (stripped.length % 4 === 1) return false;

  if (stripped.includes("=") && stripped.length % 4 !== 0) return false;

  return true;
}

function fileByteLength(content: string, encoding: "utf8" | "base64"): number {
  if (encoding === "utf8") return utf8Encoder.encode(content).byteLength;

  const stripped = content.replace(/[\r\n]+/g, "");
  let padding = 0;

  if (stripped.endsWith("==")) padding = 2;
  else if (stripped.endsWith("=")) padding = 1;

  return Math.max(0, Math.floor((stripped.length * 3) / 4) - padding);
}

const createFilePath = sandboxPath.refine(
  (value) => !(SANDBOX_ROOTS as readonly string[]).includes(value),
  { message: "invalid_path: file path cannot be a sandbox root directory" },
);

export const CreateFileRequest = z
  .object({
    path: createFilePath,
    content: z.string(),
    encoding: FileEncoding.default("utf8"),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.encoding === "base64" && !isValidBase64(file.content)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "invalid base64 content",
      });
      return;
    }

    if (fileByteLength(file.content, file.encoding) > FILE_INLINE_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: `file exceeds ${FILE_INLINE_LIMIT} byte inline limit`,
      });
    }
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
