import { z } from "zod";

export const SshKeyRequest = z.object({ key: z.string().min(1) }).strict();
