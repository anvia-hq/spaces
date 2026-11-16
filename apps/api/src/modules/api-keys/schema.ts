import { z } from "zod";

export const CreateApiKeyRequest = z
  .object({
    name: z.string().trim().min(1).max(32),
  })
  .strict();
