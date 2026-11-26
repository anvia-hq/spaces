import type { MachineSize, Sandbox, SetupStatus } from "@spaces/shared/sandbox";
import { CopyButton } from "@/components/console/copy-button";
import { Panel } from "@/components/console/panel";
import { TONE_CLASS } from "@/components/console/tone.ts";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format.ts";
import { timeUntil } from "../format.ts";

const SETUP_TONE: Record<SetupStatus, string> = {
  pending: TONE_CLASS.warning,
  running: TONE_CLASS.warning,
  done: TONE_CLASS.success,
  failed: TONE_CLASS.destructive,
};

export function MachinePanel({
  sandbox,
  size,
}: {
  sandbox: Sandbox;
  size: MachineSize | undefined;
}) {
  const rows: [string, string][] = [
    ["type", sandbox.type],
    [
      "resources",
      size
        ? `${size.vcpu} vCPU · ${size.memMib / 1024} GiB · ${size.diskGb} GiB disk`
        : "preset no longer offered",
    ],
    ["ip", sandbox.ip ?? "—"],
    ["auto-stop", sandbox.archiveAfter ? timeUntil(sandbox.archiveAfter) : "never"],
    ["created", sandbox.createdAt ? timeAgo(sandbox.createdAt) : "—"],
    ["snapshot", sandbox.snapshotAvailable ? timeAgo(sandbox.snapshotCompletedAt) : "none"],
  ];

  if (sandbox.network && sandbox.network.mode !== "default") {
    const networkLabel =
      sandbox.network.mode === "allow"
        ? `allow (${sandbox.network.allow.join(", ")})`
        : sandbox.network.mode;
    rows.push(["network", networkLabel]);
  }

  return (
    <Panel title="Machine" flush>
      <dl className="divide-y divide-border/70">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="shrink-0 text-base tracking-wide text-muted-foreground">{key}</dt>
            <dd className="min-w-0 truncate text-base text-foreground/90" title={value}>
              {value}
            </dd>
          </div>
        ))}
        {sandbox.setupStatus && (
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="shrink-0 text-base tracking-wide text-muted-foreground">setup</dt>
            <dd className="min-w-0">
              <Badge variant="outline" className={SETUP_TONE[sandbox.setupStatus]}>
                {sandbox.setupStatus}
              </Badge>
            </dd>
          </div>
        )}
      </dl>
      {sandbox.setupError && (
        <p className="border-t border-border/70 px-4 py-2 text-sm leading-relaxed break-words text-destructive">
          {sandbox.setupError}
        </p>
      )}
      {Object.keys(sandbox.labels ?? {}).length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-4 py-2.5">
          {Object.entries(sandbox.labels ?? {}).map(([key, value]) => (
            <Badge key={key} variant="outline" className="font-normal text-muted-foreground">
              {key}={value}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2 py-1.5">
        <CopyButton value={sandbox.id} label="Copy ID" />
        {sandbox.ip && <CopyButton value={sandbox.ip} label="Copy IP" />}
      </div>
    </Panel>
  );
}
