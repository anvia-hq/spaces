import { z } from "zod";

export const RuntimeParams = z.object({ runtime: z.string().min(1).max(64) }).strict();

export const RuntimeSamplesQuery = z
  .object({
    minutes: z.coerce.number().int().min(5).max(10_080).optional(),
    runtime: z.string().min(1).max(64).optional(),
  })
  .strict();
