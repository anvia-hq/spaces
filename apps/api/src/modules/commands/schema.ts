import { z } from "zod";

/** GET /commands/{processId} — tail cap and incremental byte offsets. */
export const CommandsStatusQuery = z
  .object({
    tailBytes: z.coerce.number().int().min(1).max(8388608).optional(),
    stdoutOffset: z.coerce.number().int().min(0).optional(),
    stderrOffset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

/** GET /commands/{processId}/stream — where each log starts. */
export const CommandsAttachQuery = z
  .object({
    stdoutOffset: z.coerce.number().int().min(0).default(0),
    stderrOffset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

/** GET /command-history/{commandId}/logs — paged byte reads of stored output. */
export const CommandLogsQuery = z
  .object({
    stream: z.enum(["stdout", "stderr"]).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(1048576).optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();
