import { z } from "zod";

export const RuntimeParams = z.object({ runtime: z.string().min(1).max(64) }).strict();
