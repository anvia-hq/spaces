import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type Runtime } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";
import type { IssuedToken } from "../types.ts";

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : String(e);
}

export function useRuntimes() {
  const poll = usePoll(async () => (await api.listRuntimes()).runtimes, 5000);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const runtimes = poll.data ?? [];

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

  const create = (name: string, maxSandboxes: number | null) =>
    act("create", async () => {
      const answer = await api.createRuntime({ name, maxSandboxes });
      setIssued({ runtime: answer.runtime.name, token: answer.token });
      toast.success(`Registered ${answer.runtime.name}`);
    });

  const rename = (runtime: Runtime, name: string) =>
    act(`rename:${runtime.id}`, async () => {
      await api.updateRuntime(runtime.id, { name });
      toast.success(`Renamed ${runtime.name} to ${name}`);
    });

  const setCap = (runtime: Runtime, maxSandboxes: number | null) =>
    act(`cap:${runtime.id}`, async () => {
      await api.updateRuntime(runtime.id, { maxSandboxes });
      toast.success(`Updated ${runtime.name}`);
    });

  const setDraining = (runtime: Runtime, draining: boolean) =>
    act(`drain:${runtime.id}`, async () => {
      await api.updateRuntime(runtime.id, { draining });
      toast.success(draining ? `Draining ${runtime.name}` : `${runtime.name} accepts sandboxes`);
    });

  const rotate = (runtime: Runtime) =>
    act(`rotate:${runtime.id}`, async () => {
      const answer = await api.rotateRuntimeToken(runtime.id);
      setIssued({ runtime: answer.runtime.name, token: answer.token });
      toast.success(`Rotated the token of ${runtime.name}`);
    });

  const remove = (runtime: Runtime) =>
    act(`delete:${runtime.id}`, async () => {
      await api.deleteRuntime(runtime.id);
      toast.success(`Deleted ${runtime.name}`);
    });

  return {
    runtimes,
    loading: poll.loading,
    error: poll.error,
    busy,
    issued,
    clearIssued: () => setIssued(null),
    create,
    rename,
    setCap,
    setDraining,
    rotate,
    remove,
  };
}

export type Runtimes = ReturnType<typeof useRuntimes>;
