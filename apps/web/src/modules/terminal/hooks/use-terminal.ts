import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, streamCommand, type CommandRecord } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";
import type { Mode, Output } from "../types.ts";

const EMPTY: Output = {
  commandId: null,
  stdout: "",
  stderr: "",
  exitCode: null,
  timedOut: false,
  running: false,
};

export function useTerminal(sandboxId: string) {
  const [command, setCommand] = useState("ls -la /home/user");
  const [mode, setMode] = useState<Mode>("run");
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const abort = useRef<AbortController | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const processes = usePoll(() => api.processes(sandboxId), 3000);
  const history = usePoll(() => api.commandHistory(sandboxId), 4000);

  const stopPolling = useCallback(() => {
    if (poll.current) clearInterval(poll.current);

    poll.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abort.current?.abort();
      stopPolling();
    };
  }, [stopPolling]);

  const follow = useCallback(
    (processId: number, commandId: string) => {
      let stdoutOffset = 0;
      let stderrOffset = 0;
      let stdout = "";
      let stderr = "";

      stopPolling();
      poll.current = setInterval(async () => {
        try {
          const status = await api.commandStatus(sandboxId, processId, {
            stdoutOffset,
            stderrOffset,
          });

          if (status.stdout) stdout += status.stdout;

          if (status.stderr) stderr += status.stderr;

          stdoutOffset = status.stdoutNextOffset;
          stderrOffset = status.stderrNextOffset;

          setOutput({
            commandId,
            stdout,
            stderr,
            exitCode: status.exitCode,
            timedOut: false,
            running: status.running,
            pid: processId,
            startedAt: status.startedAt ?? undefined,
            finishedAt: status.finishedAt,
          });

          if (!status.running) {
            stopPolling();
            void history.refresh();
          }
        } catch {}
      }, 700);
    },
    [sandboxId, stopPolling, history],
  );

  async function start() {
    if (!command.trim()) return;

    setError(null);
    setBusy(true);
    abort.current?.abort();
    stopPolling();

    try {
      if (mode === "run") {
        setOutput({ ...EMPTY, running: true });
        const result = await api.runCommand(sandboxId, command);
        setOutput({
          commandId: result.commandId,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          running: false,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        });
        void history.refresh();
      } else if (mode === "stream") {
        const controller = new AbortController();
        abort.current = controller;
        const next: Output = { ...EMPTY, running: true };
        setOutput({ ...next });

        for await (const frame of streamCommand(sandboxId, command, {
          signal: controller.signal,
        })) {
          if (frame.type === "started") {
            next.commandId = frame.commandId;
            next.startedAt = frame.startedAt;
          } else if (frame.type === "stdout") {
            next.stdout += frame.data;
          } else if (frame.type === "stderr") {
            next.stderr += frame.data;
          } else if (frame.type === "exit") {
            next.exitCode = frame.exitCode;
            next.timedOut = frame.timedOut;
            next.running = false;
          } else if (frame.type === "error") {
            setError(`${frame.error}: ${frame.message}`);
            next.running = false;
          }

          setOutput({ ...next });
        }
        setOutput((o) => (o ? { ...o, running: false } : o));
        void history.refresh();
      } else {
        const started = await api.startProcess(sandboxId, command);
        setOutput({
          commandId: started.commandId,
          stdout: "",
          stderr: "",
          exitCode: null,
          timedOut: false,
          running: true,
          pid: started.processId,
          startedAt: started.startedAt,
        });
        follow(started.processId, started.commandId);
        void history.refresh();
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";

      if (!aborted) setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));

      setOutput((o) => (o ? { ...o, running: false } : o));
    } finally {
      setBusy(false);
    }
  }

  async function kill(pid: number) {
    try {
      await api.killProcess(sandboxId, pid);
      stopPolling();
      setOutput((o) => (o ? { ...o, running: false } : o));
      void history.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  async function loadLogs(record: CommandRecord) {
    setError(null);
    try {
      const logs = await api.commandLogs(sandboxId, record.commandId, {
        stream: "stdout",
        encoding: "utf8",
        limit: 1024 * 1024,
      });
      const err = await api.commandLogs(sandboxId, record.commandId, {
        stream: "stderr",
        encoding: "utf8",
        limit: 1024 * 1024,
      });
      setOutput({
        commandId: record.commandId,
        stdout: logs.data,
        stderr: err.data,
        exitCode: record.exitCode,
        timedOut: record.status === "timed_out",
        running: record.status === "running",
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
      });
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  const tracked = (processes.data?.processes ?? []).filter((p) => p.commandId);

  return {
    command,
    setCommand,
    mode,
    setMode,
    output,
    error,
    busy,
    start,
    kill,
    loadLogs,
    processes,
    tracked,
    history,
  };
}
