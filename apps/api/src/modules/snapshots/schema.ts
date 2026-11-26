import { z } from "zod";
import { SANDBOX_ID } from "@spaces/shared/sandbox";

export const SavedSnapshotSaveRequest = z
  .object({
    sandboxId: z.string().regex(SANDBOX_ID, "not a sandbox id"),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "1-63 lowercase letters, digits or dashes"),
  })
  .strict();

export const SnapshotFileQuery = z.object({ path: z.string().optional() }).strict();

export const SavedSnapshotListQuery = z
  .object({
    name: z.string().optional(),
    namePrefix: z.string().optional(),
  })
  .strict();
