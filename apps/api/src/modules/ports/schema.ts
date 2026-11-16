import { z } from "zod";

export const HostPortRequest = z
  .object({
    port: z.number().int().min(1).max(65535),
    public: z.boolean().optional(),
    localhost: z.boolean().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();
