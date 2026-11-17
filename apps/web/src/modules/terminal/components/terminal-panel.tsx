import { CornerDownLeft, History, Square, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TONE_CLASS } from "@/components/console/tone.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Segmented } from "@/components/console/segmented";
import { Skeleton } from "@/components/console/skeleton";
import { fmtBytes, timeAgo } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { useTerminal } from "../hooks/use-terminal.ts";
import type { Mode } from "../types.ts";
import { OutputView } from "./output-view.tsx";
import { ProcessRow } from "./process-row.tsx";

function exitTone(running: boolean, ok: boolean): string {
  if (running) return "text-warning";

  return ok ? "text-primary" : "text-destructive";
}

const MODES: { value: Mode; label: string }[] = [
  { value: "run", label: "Sync" },
  { value: "stream", label: "Stream" },
  { value: "background", label: "Background" },
];

export function TerminalPanel({ sandboxId, live }: { sandboxId: string; live: boolean }) {
  const {
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
  } = useTerminal(sandboxId);

  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-3">
            <Segmented label="Execution mode" options={MODES} value={mode} onChange={setMode} />
            {!live && (
              <span className="text-base text-warning">Resume the sandbox to run commands.</span>
            )}
          </div>

          <div className="group relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-primary"
            >
              $
            </span>
            <Input
              className="h-10 pr-24 pl-7 "
              value={command}
              spellCheck={false}
              aria-label="Command"
              placeholder="uname -a"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && live) void start();
              }}
              disabled={!live}
            />
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1.5">
              <kbd className="hidden rounded border border-border px-1 text-base text-muted-foreground sm:block">
                ⏎
              </kbd>
              <Button
                size="sm"
                className="h-7"
                disabled={!live || busy}
                onClick={() => void start()}
              >
                {busy ? <Spinner className="size-3.5" /> : <CornerDownLeft className="size-3.5" />}
                {mode === "background" ? "Start" : "Run"}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="px-3 pb-3">
            <Notice>{error}</Notice>
          </div>
        )}

        {output ? (
          <div className="border-t border-border/70">
            <OutputView
              stdout={output.stdout}
              stderr={output.stderr}
              exitCode={output.exitCode}
              timedOut={output.timedOut}
              running={output.running}
              height="max-h-[420px]"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/70 px-3 py-2 text-base text-muted-foreground">
              {output.commandId && <code>{output.commandId}</code>}
              {output.pid != null && <span>pid {output.pid}</span>}
              {output.startedAt && <span>started {timeAgo(output.startedAt)}</span>}
              <span className="ml-auto flex items-center gap-2">
                {output.running && output.pid != null ? (
                  <Button size="sm" variant="destructive" onClick={() => void kill(output.pid!)}>
                    <Square className="size-3" />
                    Stop
                  </Button>
                ) : (
                  <span>{fmtBytes(output.stdout.length + output.stderr.length)} of output</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="border-t border-border/70 px-4 py-10 text-center">
            <TerminalSquare className="mx-auto size-5 text-muted-foreground/60" />
            <p className="mt-2 text-base text-muted-foreground">
              Nothing run yet. Commands execute in{" "}
              <span className="text-foreground/80">/home/user</span>.
            </p>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Processes"
          subtitle={processes.data ? `${processes.data.total} live in the guest` : undefined}
          flush
        >
          {tracked.length === 0 ? (
            <EmptyState
              glyph="⌁"
              title="No tracked processes"
              hint="Background commands appear here with their pid and memory."
            />
          ) : (
            <ul role="list" className="max-h-[300px] divide-y divide-border/70 overflow-auto">
              {tracked.map((p) => (
                <ProcessRow key={p.pid} process={p} onKill={() => void kill(p.pid)} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="History"
          subtitle="Every command, kept after the sandbox stops."
          action={<History className="size-3.5 text-muted-foreground" />}
          flush
        >
          {(history.data?.commands.length ?? 0) === 0 ? (
            <EmptyState glyph="≡" title="Nothing yet" hint="Commands you run are recorded here." />
          ) : (
            <ul role="list" className="max-h-[300px] divide-y divide-border/70 overflow-auto">
              {history.data?.commands.slice(0, 40).map((c) => {
                const running = c.status === "running";
                const ok = c.exitCode === 0;
                return (
                  <li key={c.commandId}>
                    <button
                      type="button"
                      onClick={() => void loadLogs(c)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:text-foreground"
                    >
                      <span className={cn("w-6 shrink-0 text-base", exitTone(running, ok))}>
                        {running ? "··" : (c.exitCode ?? "—")}
                      </span>
                      <code className="min-w-0 flex-1 truncate text-base text-foreground/90">
                        {c.command}
                      </code>
                      {c.status === "timed_out" && (
                        <Badge variant="outline" className={TONE_CLASS.warning}>
                          timeout
                        </Badge>
                      )}
                      <span className="shrink-0 text-base text-muted-foreground">
                        {timeAgo(c.startedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {processes.loading && !processes.data && <Skeleton className="h-24 w-full rounded-xl" />}
    </div>
  );
}
