import { useEffect, useRef } from "react";
import { Frame, FramePanel } from "@/components/reui/frame";
import { cn } from "@/lib/utils";

function fmtBytesLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KiB", "MiB", "GiB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function dotTone(exitCode: number | null | undefined): string {
  if (exitCode === 0) return "bg-primary";

  if (exitCode == null) return "bg-muted-foreground/50";

  return "bg-destructive";
}

export function OutputView({
  stdout,
  stderr,
  exitCode,
  timedOut,
  running,
  height = "max-h-72",
}: {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  timedOut?: boolean;
  running?: boolean;
  height?: string;
}) {
  const endRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [stdout, stderr, running]);

  const empty = !stdout && !stderr;

  return (
    <Frame spacing="xs" className="w-full">
      <FramePanel className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-base tracking-wide text-muted-foreground">
            {running ? (
              <>
                <span className="size-1.5 rounded-full bg-primary live-dot" />
                running
              </>
            ) : (
              <>
                <span className={cn("size-1.5 rounded-full", dotTone(exitCode))} />
                exit {exitCode ?? "—"}
                {timedOut && <span className="text-warning">· timed out</span>}
              </>
            )}
          </span>
          {(stdout || stderr) && (
            <span className="text-base text-muted-foreground">
              {fmtBytesLocal(stdout.length + stderr.length)}
            </span>
          )}
        </div>
        <pre
          className={cn(
            "overflow-auto px-3 py-2.5 text-base leading-relaxed text-foreground/90",
            height,
          )}
        >
          {empty && !running ? (
            <span className="text-muted-foreground/60">no output</span>
          ) : (
            <>
              {stdout}
              {stderr && <span className="text-destructive">{stderr}</span>}
              <span ref={endRef} />
            </>
          )}
        </pre>
      </FramePanel>
    </Frame>
  );
}
