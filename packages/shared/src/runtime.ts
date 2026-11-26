import { z } from "zod";

export const AGENT_VERSION = "0.1.0";

export const PROTOCOL_VERSION = 1;

export const RUNTIME_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const LOCAL_RUNTIME_ID = "local";
export const RUNTIME_PATH = "/runtime/connect";
export const HEARTBEAT_MS = 5_000;
export const HEARTBEAT_MISSES = 3;
export const CALL_TIMEOUT_MS = 15 * 60_000;
export const MAX_FRAME_BYTES = 512 * 1024 * 1024;
export const MAX_CALL_FRAME_CHARS = 120 * 1024 * 1024;

export const RuntimeKind = z.enum(["local", "agent"]);
export type RuntimeKind = z.infer<typeof RuntimeKind>;

export const RuntimeState = z.enum(["online", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

export const DriverCapabilities = z.object({
  exec: z.boolean(),
  files: z.boolean(),
  persistence: z.boolean(),
});
export type DriverCapabilities = z.infer<typeof DriverCapabilities>;

export const Resources = z.object({
  vcpu: z.number().int().min(1),
  memMib: z.number().int().min(256),
});
export type Resources = z.infer<typeof Resources>;

export const RuntimeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RuntimeKind,
  state: RuntimeState,
  draining: z.boolean(),
  labels: z.record(z.string()),
  maxSandboxes: z.number().int().nullable(),
  activeSandboxes: z.number().int(),
  totalSandboxes: z.number().int(),
  snapshots: z.number().int(),
  resources: Resources.nullable(),
  committed: z.object({ vcpu: z.number().int(), memMib: z.number().int() }),
  overcommit: z.number(),
  driver: z.string().nullable(),
  capabilities: DriverCapabilities.nullable(),
  publicHost: z.string().nullable(),
  agentVersion: z.string().nullable(),
  protocol: z.number().int().nullable(),
  tokenPrefix: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Runtime = z.infer<typeof RuntimeSchema>;

export const RuntimeSampleSchema = z.object({
  runtimeId: z.string(),
  at: z.string().datetime(),
  activeSandboxes: z.number().int(),
  vcpuCommitted: z.number().int(),
  memMibCommitted: z.number().int(),
  vcpuCapacity: z.number().int().nullable(),
  memMibCapacity: z.number().int().nullable(),
});
export type RuntimeSample = z.infer<typeof RuntimeSampleSchema>;

const labels = z
  .record(z.string().max(256))
  .refine((value) => Object.keys(value).length <= 20, { message: "at most 20 labels" });

export const CreateRuntimeRequest = z
  .object({
    name: z.string().regex(RUNTIME_NAME, {
      message: "1-32 lowercase letters, digits or dashes, starting with a letter",
    }),
    labels: labels.default({}),
    maxSandboxes: z.number().int().min(1).max(100_000).nullable().default(null),
  })
  .strict();
export type CreateRuntimeRequest = z.infer<typeof CreateRuntimeRequest>;

export const UpdateRuntimeRequest = z
  .object({
    name: z
      .string()
      .regex(RUNTIME_NAME, {
        message: "1-32 lowercase letters, digits or dashes, starting with a letter",
      })
      .optional(),
    labels: labels.optional(),
    maxSandboxes: z.number().int().min(1).max(100_000).nullable().optional(),
    draining: z.boolean().optional(),
  })
  .strict();
export type UpdateRuntimeRequest = z.infer<typeof UpdateRuntimeRequest>;

export const DRIVER_METHODS = [
  "create",
  "resume",
  "fork",
  "restore",
  "stop",
  "destroy",
  "snapshot",
  "destroySnapshot",
  "isRunning",
  "exec",
  "guestIp",
  "publishPort",
  "unpublishPort",
  "restart",
  "restoreTemporary",
  "removeTemporary",
  "listSnapshotTree",
  "readSnapshotEntry",
  "startProcess",
  "processState",
  "killProcess",
  "readProcessOutput",
  "listProcesses",
  "readFile",
  "writeFile",
  "listFiles",
  "fileInfo",
  "makeFolder",
  "setPermissions",
  "movePath",
  "removePath",
  "searchFiles",
  "findInFiles",
  "listeningPorts",
  "isPortFree",
  "forgetPort",
  "proxyHttp",
] as const;
export type DriverMethod = (typeof DRIVER_METHODS)[number];

export const AgentHello = z.object({
  t: z.literal("hello"),
  protocol: z.number().int(),
  agentVersion: z.string(),
  driver: z.string(),
  capabilities: DriverCapabilities,
  resources: Resources.nullable().default(null),
  portRange: z.object({ start: z.number().int(), end: z.number().int() }).nullable(),
  portBind: z.string(),
  publicHost: z.string().nullable(),
});
export type AgentHello = z.infer<typeof AgentHello>;

export const Heartbeat = z.object({ t: z.literal("heartbeat") });

export const WireError = z.object({
  name: z.enum(["DriverFailure", "DriverUnsupported", "Error"]),
  message: z.string(),
  detail: z.string().optional(),
  operation: z.string().optional(),
  reason: z.string().optional(),
});
export type WireError = z.infer<typeof WireError>;

export const AgentFrame = z.union([
  AgentHello,
  Heartbeat,
  z.object({
    t: z.literal("result"),
    id: z.number().int(),
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.object({
    t: z.literal("result"),
    id: z.number().int(),
    ok: z.literal(false),
    error: WireError,
  }),
  z.object({ t: z.literal("chunk"), id: z.number().int(), data: z.unknown() }),
  z.object({ t: z.literal("end"), id: z.number().int() }),
  z.object({ t: z.literal("abort"), id: z.number().int(), message: z.string() }),
]);
export type AgentFrame = z.infer<typeof AgentFrame>;

export const ProxyHead = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  hasBody: z.boolean(),
});
export type ProxyHead = z.infer<typeof ProxyHead>;

export const ControlFrame = z.discriminatedUnion("t", [
  z.object({ t: z.literal("cancel"), id: z.number().int() }),
  z.object({
    t: z.literal("welcome"),
    runtimeId: z.string(),
    protocol: z.number().int(),
    heartbeatMs: z.number().int(),
  }),
  z.object({
    t: z.literal("call"),
    id: z.number().int(),
    method: z.enum(DRIVER_METHODS),
    args: z.array(z.unknown()),
  }),
]);
export type ControlFrame = z.infer<typeof ControlFrame>;

const BYTES_KEY = "$b64";

export function encodeFrame(frame: unknown): string {
  return JSON.stringify(frame, function (this: Record<string, unknown>, key, value) {
    const original = this[key];

    if (original instanceof Uint8Array) {
      return { [BYTES_KEY]: Buffer.from(original).toString("base64") };
    }

    return value;
  });
}

export function decodeFrame(text: string): unknown {
  return JSON.parse(text, (_key, value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>)[BYTES_KEY] === "string"
    ) {
      return new Uint8Array(Buffer.from((value as Record<string, string>)[BYTES_KEY]!, "base64"));
    }

    return value;
  });
}

export function runtimeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `spr_${Buffer.from(bytes).toString("hex")}`;
}
