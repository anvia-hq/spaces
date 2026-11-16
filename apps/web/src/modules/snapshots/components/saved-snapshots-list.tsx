import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Search, Share2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { PageHeader } from "@/components/console/page-header";
import { IconStack } from "@/components/reui/icon-stack";
import { Notice } from "@/components/console/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBytes, timeAgo } from "@/lib/format.ts";
import { useSavedSnapshotList } from "../hooks/use-saved-snapshot-list.ts";
import { Shares } from "./shares.tsx";
import { SnapshotFiles } from "./snapshot-files.tsx";
import { SnapshotStatusBadge } from "./snapshot-status-badge.tsx";

export function SavedSnapshotsList({
  filter,
  onFilterChange,
}: {
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const { saved, busy, expanded, setExpanded, remove } = useSavedSnapshotList();

  const all = saved.data?.snapshots ?? [];
  const list = filter
    ? all.filter(
        (s) =>
          s.name.includes(filter.toLowerCase()) || s.sourceSandboxId.includes(filter.toLowerCase()),
      )
    : all;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Snapshots"
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 w-[230px] pl-8 text-base"
              value={filter}
              placeholder="filter by name or id"
              aria-label="Filter snapshots"
              onChange={(e) => onFilterChange(e.target.value)}
            />
          </div>
        }
      />

      {saved.error && !saved.data && <Notice kind="error">{saved.error}</Notice>}

      {saved.loading && !saved.data && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {saved.data && all.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-16 text-center">
          <IconStack>
            <Share2 className="size-5" />
          </IconStack>
          <div>
            <p className="text-base font-medium text-foreground">No saved snapshots</p>
            <p className="mx-auto mt-1 max-w-sm text-base leading-relaxed text-muted-foreground">
              Open a sandbox and use its Snapshots tab to freeze the disk under a name.
            </p>
          </div>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
            Go to sandboxes
          </Button>
        </div>
      )}

      {list.length > 0 && (
        <ul
          role="list"
          className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/40"
        >
          {list.map((s) => {
            const open = expanded === s.name;
            return (
              <li key={s.name} className="border-b border-border/70 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-accent/30">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-foreground">{s.name}</span>
                    <span className="flex items-center gap-x-2 text-base text-muted-foreground">
                      <span>{fmtBytes(s.sizeBytes)}</span>
                      <span aria-hidden className="text-border">
                        /
                      </span>
                      <span>{timeAgo(s.createdAt)}</span>
                      <span aria-hidden className="text-border">
                        /
                      </span>
                      <Link
                        to="/sandboxes/$sandboxId"
                        params={{ sandboxId: s.sourceSandboxId }}
                        className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
                      >
                        from {s.sourceSandboxId}
                        <ArrowUpRight className="size-2.5" />
                      </Link>
                    </span>
                  </div>

                  <SnapshotStatusBadge status={s.status} size="sm" />

                  <div className="ml-auto flex items-center gap-1.5">
                    {s.snapshotId && s.status === "ready" && (
                      <Button
                        size="sm"
                        variant={open ? "secondary" : "outline"}
                        onClick={() => setExpanded(open ? null : s.name)}
                      >
                        {open ? "Hide" : "Files & sharing"}
                      </Button>
                    )}
                    <ConfirmDialog
                      trigger="Delete"
                      title={`Delete ${s.name}?`}
                      description="The frozen disk and every share code pointing at it are destroyed."
                      confirmLabel="Delete snapshot"
                      destructive
                      busy={busy === `del:${s.name}`}
                      onConfirm={() => void remove(s)}
                    />
                  </div>
                </div>

                {s.error && (
                  <p className="px-4 pb-2 text-base leading-relaxed text-destructive">{s.error}</p>
                )}

                {open && s.snapshotId && (
                  <div className="grid gap-3 px-4 pt-1 pb-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <SnapshotFiles snapshotId={s.snapshotId} />
                    <Shares name={s.name} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
