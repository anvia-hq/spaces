import { useState } from "react";
import { Download, Search } from "lucide-react";
import { Notice } from "@/components/console/notice";
import { Skeleton } from "@/components/console/skeleton";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api.ts";
import { fmtBytes } from "@/lib/format.ts";
import { usePoll } from "@/lib/use-poll.ts";
import { EntryIcon } from "@/components/console/entry-icon";

export function SnapshotFiles({ snapshotId }: { snapshotId: string }) {
  const tree = usePoll(() => api.snapshotTree(snapshotId), 60_000);
  const [filter, setFilter] = useState("");

  if (tree.loading && !tree.data) return <Skeleton className="h-24 w-full rounded-xl" />;

  if (tree.error) return <Notice>{tree.error}</Notice>;

  const entries = (tree.data?.entries ?? []).filter((e) =>
    filter ? e.path.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-1.5">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <Input
          className="h-7 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/60"
          placeholder="filter files…"
          value={filter}
          aria-label="Filter snapshot files"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
        />
        <span className="shrink-0 text-base text-muted-foreground">
          {tree.data?.fileCount ?? 0} files · {fmtBytes(tree.data?.totalSizeBytes)}
        </span>
      </div>
      <ul role="list" className="max-h-60 overflow-auto">
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
                <EntryIcon isDir={false} />
                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                <span className="shrink-0 text-muted-foreground">{fmtBytes(entry.size)}</span>
              </a>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1 text-base text-muted-foreground">
                <EntryIcon isDir />
                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <a
        href={api.snapshotFileUrl(snapshotId, "")}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 border-t border-border/70 px-2.5 py-1.5 text-base text-primary transition-colors hover:bg-primary/5"
      >
        <Download className="size-3" />
        download whole workdir (tar)
      </a>
    </div>
  );
}
