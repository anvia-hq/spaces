import { z } from "zod";
import { CreateSandboxRequest } from "@spaces/shared/sandbox";

export const SandboxSortParam = z.enum(["createdAt:desc", "createdAt:asc", "updatedAt:desc"]);

export const SandboxListQuery = z
  .object({
    state: z.string().optional(),
    name: z.string().optional(),
    namePrefix: z.string().optional(),
    stoppedBefore: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    sort: SandboxSortParam.optional(),
    label: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

export const ForkRequest = CreateSandboxRequest.pick({
  type: true,
  ttlSeconds: true,
  name: true,
  labels: true,
  env: true,
  network: true,
}).partial();

export const ResumeRequest = z
  .object({
    type: CreateSandboxRequest.shape.type.optional(),
    ttlSeconds: CreateSandboxRequest.shape.ttlSeconds.optional(),
    name: z.string().max(120).optional(),
    env: CreateSandboxRequest.shape.env.optional(),
  })
  .strict();

export const StopRequest = z.object({ force: z.boolean().optional() }).strict().optional();

export const EventsQuery = z.object({ after: z.coerce.number().int().min(0).optional() }).strict();
