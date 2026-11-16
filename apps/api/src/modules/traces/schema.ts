import { z } from "zod";

export const TraceListQuery = z
  .object({
    traceId: z.string().max(64).optional(),
    requestId: z.string().max(64).optional(),
    name: z.string().max(80).optional(),
    status: z.enum(["ok", "error"]).optional(),
    since: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const MetricsQuery = z
  .object({ windowMinutes: z.coerce.number().int().min(1).max(10080).optional() })
  .strict();
