import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function usePorts(sandboxId: string) {
  const ports = usePoll(() => api.publishedPorts(sandboxId), 4000);
  const [port, setPort] = useState("3000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});

  async function host(target: number) {
    setBusy(`host:${target}`);
    setError(null);
    try {
      const hosted = await api.hostPort(sandboxId, target);
      setUrls((prev) => ({ ...prev, [target]: hosted.url }));

      if (hosted.restartRequired) {
        toast.warning(hosted.message ?? "The microVM restarted to add this port.");
      } else {
        toast.success(`Port ${target} is published`);
      }

      await ports.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function unhost(target: number) {
    setBusy(`unhost:${target}`);
    setError(null);
    try {
      await api.unhostPort(sandboxId, target);
      setUrls((prev) => {
        const next = { ...prev };
        delete next[target];
        return next;
      });
      await ports.refresh();
      toast.success(`Port ${target} unpublished`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  const all = ports.data?.ports ?? [];
  const list = all.filter((p) => p.explicit);
  const reserved = all.flatMap((p) => (p.explicit ? [] : [p.port]));

  return { ports, port, setPort, busy, error, urls, host, unhost, list, reserved };
}
