import { z } from "zod";

export const UsageQuery = z
  .object({
    since: z.string().optional(),
    until: z.string().optional(),
  })
  .strict();
