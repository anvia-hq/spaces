import type { MachineSize, Sandbox } from "@spaces/shared/sandbox";
import { CopyButton } from "@/components/console/copy-button";
import { Panel } from "@/components/console/panel";
import { Badge } from "@/components/reui/badge";
import { timeAgo } from "@/lib/format.ts";
import { timeUntil } from "../format.ts";

export function MachinePanel({
  sandbox,
  size,
}: {
  sandbox: Sandbox;
  size: MachineSize | undefined;
}) {
  return (
    <Panel title="Machine" flush>
      <dl className="divide-y divide-border/70">
        {[
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
        ].map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="text-base tracking-wide text-muted-foreground">{key}</dt>
            <dd className="truncate text-base text-foreground/90" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(sandbox.labels ?? {}).length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-4 py-2.5">
          {Object.entries(sandbox.labels ?? {}).map(([key, value]) => (
            <Badge
              key={key}
              variant="outline"
              size="sm"
              className="font-normal text-muted-foreground"
            >
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
