import { useState } from "react";
import { toast } from "sonner";
import type { MachineSize } from "@spaces/shared/sandbox";
import { ApiError, api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export type MachineSizePatch = {
  vcpu: number;
  memMib: number;
  diskGb: number;
  description: string | null;
};

export type NewMachineSize = {
  name: string;
  vcpu: number;
  memMib: number;
  diskGb: number;
  description: string | null;
};

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : String(e);
}

export function useMachineSizeAdmin(includeRetired = false) {
  const poll = usePoll(() => api.machineSizes({ includeRetired }), 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const sizes: MachineSize[] = poll.data?.sizes ?? [];

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);

    try {
      await fn();
      await poll.refresh();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  const create = (size: NewMachineSize) =>
    act("create", async () => {
      await api.createMachineSize({
        name: size.name,
        vcpu: size.vcpu,
        memMib: size.memMib,
        diskGb: size.diskGb,
        description: size.description,
      });
      toast.success(`Preset ${size.name} added`);
    });

  const update = (size: MachineSize, patch: MachineSizePatch) =>
    act(`update-${size.name}`, async () => {
      await api.updateMachineSize(size.name, {
        vcpu: patch.vcpu,
        memMib: patch.memMib,
        diskGb: patch.diskGb,
        description: patch.description,
      });
      toast.success(`Preset ${size.name} updated`);
    });

  const retire = (size: MachineSize) =>
    act(`retire-${size.name}`, async () => {
      const answer = await api.retireMachineSize(size.name);

      toast.success(
        answer.inUse > 0
          ? `Preset ${size.name} retired; ${answer.inUse} existing sandbox${answer.inUse === 1 ? "" : "es"} keep it`
          : `Preset ${size.name} retired`,
      );
    });

  return {
    poll,
    sizes,
    active: sizes.filter((size) => size.retiredAt === null),
    busy,
    create,
    update,
    retire,
  };
}

export type MachineSizes = ReturnType<typeof useMachineSizeAdmin>;
