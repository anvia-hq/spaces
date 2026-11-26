import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { MachineSize } from "@spaces/shared/sandbox";
import { ApiError, api, type ManagedUser } from "@/lib/api.ts";

export type Members = ReturnType<typeof useMembers>;

export function useMembers() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sizes, setSizes] = useState<MachineSize[]>([]);

  const load = useCallback(async () => {
    try {
      const [people, presets] = await Promise.all([
        api.listUsers({ limit: 200 }),
        api.machineSizes(),
      ]);
      setUsers(people.users);
      setTotal(people.total);
      setSizes(presets.sizes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (key: string, run: () => Promise<string>) => {
      setBusy(key);

      try {
        toast.success(await run());
        await load();
      } catch (e) {
        const message = e instanceof ApiError ? e.message : String(e);
        setError(message);
        toast.error(message);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const setRole = useCallback(
    (user: ManagedUser, role: "admin" | "user") =>
      change(`role:${user.id}`, async () => {
        const answer = await api.setUserRole(user.id, role);
        return `${answer.user.email} is now ${answer.user.role}`;
      }),
    [change],
  );

  const ban = useCallback(
    (user: ManagedUser, reason: string | null) =>
      change(`ban:${user.id}`, async () => {
        await api.banUser(user.id, reason);
        return `Banned ${user.email}`;
      }),
    [change],
  );

  const unban = useCallback(
    (user: ManagedUser) =>
      change(`ban:${user.id}`, async () => {
        await api.unbanUser(user.id);
        return `Lifted the ban on ${user.email}`;
      }),
    [change],
  );

  const addSize = useCallback(
    (input: { name: string; vcpu: number; memMib: number; diskGb: number }) =>
      change(`size:${input.name}`, async () => {
        await api.createMachineSize(input);
        return `Added ${input.name}`;
      }),
    [change],
  );

  const retireSize = useCallback(
    (size: MachineSize) =>
      change(`size:${size.name}`, async () => {
        const answer = await api.retireMachineSize(size.name);
        return `Retired ${answer.name} (${answer.inUse} sandbox${answer.inUse === 1 ? "" : "es"} used it)`;
      }),
    [change],
  );

  return {
    users,
    total,
    sizes,
    loading,
    error,
    busy,
    reload: load,
    setRole,
    ban,
    unban,
    addSize,
    retireSize,
  };
}
