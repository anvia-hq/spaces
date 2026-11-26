import { z } from "zod";

export const CommandsStatusQuery = z
  .object({
    tailBytes: z.coerce.number().int().min(1).max(8388608).optional(),
    stdoutOffset: z.coerce.number().int().min(0).optional(),
    stderrOffset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const CommandsAttachQuery = z
  .object({
    stdoutOffset: z.coerce.number().int().min(0).default(0),
    stderrOffset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const CommandLogsQuery = z
  .object({
    stream: z.enum(["stdout", "stderr"]).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(1048576).optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();
