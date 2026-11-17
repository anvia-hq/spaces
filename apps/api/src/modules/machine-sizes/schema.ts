import { z } from "zod";
import { MACHINE_SIZE_NAME } from "@spaces/shared/sandbox";

export const MachineSizeNameParams = z
  .object({ name: z.string().regex(MACHINE_SIZE_NAME) })
  .strict();

const vcpu = z.number().int().min(1).max(64);
const memMib = z.number().int().min(512).max(262_144);
const diskGb = z.number().int().min(5).max(2048);
const description = z.string().max(200).nullable();

export const CreateMachineSizeRequest = z
  .object({
    name: z.string().regex(MACHINE_SIZE_NAME),
    vcpu,
    memMib,
    diskGb,
    description: description.optional(),
  })
  .strict();

export const UpdateMachineSizeRequest = z
  .object({
    vcpu: vcpu.optional(),
    memMib: memMib.optional(),
    diskGb: diskGb.optional(),
    description: description.optional(),
  })
  .strict();

export const MachineSizeListQuery = z
  .object({ includeRetired: z.enum(["true", "false"]).optional() })
  .strict();
