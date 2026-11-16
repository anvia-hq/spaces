import { z } from "zod";
import { CreateSandboxRequest } from "@spaces/shared/sandbox";

export const SandboxListQuery = z
  .object({
    state: z.string().optional(),
    name: z.string().optional(),
    namePrefix: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    sort: z.string().optional(),
    include: z.string().optional(),
    label: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

export const ForkRequest = CreateSandboxRequest.partial();

/**
 * Boat's resume request. `ttlSeconds` resets the auto-stop timer, `type` moves
 * the sandbox to another machine size, `name` renames it. The rest is accepted
 * for parity and ignored (docs/decision/0021).
 */
export const ResumeRequest = z
  .object({
    type: CreateSandboxRequest.shape.type.optional(),
    ttlSeconds: CreateSandboxRequest.shape.ttlSeconds.optional(),
    name: z.string().max(120).optional(),
    failFast: z.boolean().optional(),
    env: CreateSandboxRequest.shape.env.optional(),
    environment: z.string().max(120).optional(),
    noEnv: z.boolean().optional(),
  })
  .strict();

/** POST /stop — optional force escalates an in-flight stop. */
export const StopRequest = z.object({ force: z.boolean().optional() }).strict().optional();

export const EventsQuery = z.object({ after: z.coerce.number().int().min(0).optional() }).strict();
