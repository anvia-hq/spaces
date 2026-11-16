import { z } from "zod";

/** GET /usage — billing window, ISO 8601 or epoch seconds. */
export const UsageQuery = z
  .object({
    since: z.string().optional(),
    until: z.string().optional(),
  })
  .strict();
