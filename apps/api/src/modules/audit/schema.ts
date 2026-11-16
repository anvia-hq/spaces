import { z } from "zod";

export const AuditQuery = z
  .object({
    action: z.string().max(80).optional(),
    actorId: z.string().max(80).optional(),
    targetType: z.string().max(40).optional(),
    targetId: z.string().max(120).optional(),
    result: z.enum(["ok", "error"]).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().max(300).optional(),
  })
  .strict();
