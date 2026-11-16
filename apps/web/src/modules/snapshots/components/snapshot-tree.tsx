import { useState } from "react";
import { Download, Search } from "lucide-react";
import { CopyButton } from "@/components/console/copy-button";
import { Notice } from "@/components/console/notice";
import { Skeleton } from "@/components/console/skeleton";
import { FileType } from "@/components/reui/file-type";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api.ts";
import { fmtBytes } from "@/lib/format.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function SnapshotTree({ snapshotId }: { snapshotId: string }) {
  const tree = usePoll(() => api.snapshotTree(snapshotId), 60_000);
  const [filter, setFilter] = useState("");

  if (tree.loading && !tree.data) {
    return (
      <div className="flex flex-col gap-1.5 px-3.5 pb-3">
        <Skeleton className="h-6 w-full rounded-md" />
        <Skeleton className="h-6 w-3/4 rounded-md" />
      </div>
    );
  }

  if (tree.error) {
    return (
      <div className="px-3.5 pb-3">
        <Notice>{tree.error}</Notice>
      </div>
    );
  }

  const entries = (tree.data?.entries ?? []).filter((entry) =>
    filter ? entry.path.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div className="mx-3.5 mb-3 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-1.5">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <Input
          className="h-7 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/60"
          placeholder="filter paths…"
          value={filter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          aria-label="Filter snapshot files"
        />
        <span className="shrink-0 text-base text-muted-foreground">
          {tree.data?.fileCount ?? 0} files · {fmtBytes(tree.data?.totalSizeBytes)}
        </span>
      </div>
      <ul role="list" className="max-h-64 overflow-auto">
        {entries.length === 0 && (
          <li className="px-2.5 py-2 text-base text-muted-foreground">no matches</li>
        )}
        {entries.map((entry) => (
          <li key={entry.path}>
            {entry.kind === "file" ? (
              <a
                href={api.snapshotFileUrl(snapshotId, entry.path)}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 px-2.5 py-1 text-base text-foreground/90 transition-colors hover:bg-accent/60"
              >
                <FileType type={entry.path} size="mini" variant="mono" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                <span className="shrink-0 text-muted-foreground">{fmtBytes(entry.size)}</span>
              </a>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1 text-base text-muted-foreground">
                <FileType type="folder" size="mini" variant="mono" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2.5 py-1.5">
        <a
          href={api.snapshotFileUrl(snapshotId, "")}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-base text-primary hover:underline"
        >
          <Download className="size-3" />
          download workdir (tar)
        </a>
        <CopyButton value={api.snapshotFileUrl(snapshotId, "")} label="URL" />
      </div>
    </div>
  );
}
