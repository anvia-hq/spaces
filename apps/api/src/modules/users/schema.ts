import { z } from "zod";

export const UserListQuery = z
  .object({
    search: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const UserIdParams = z.object({ userId: z.string().min(1).max(120) });

export const SetRoleRequest = z.object({ role: z.enum(["admin", "user"]) }).strict();

export const BanRequest = z.object({ reason: z.string().max(280).nullable().optional() }).strict();
