import { Camera, ChevronDown, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { fmtBytes, timeAgo } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { useSandboxSnapshots } from "../hooks/use-sandbox-snapshots.ts";
import { suggestName } from "../names.ts";
import { SnapshotStatusBadge } from "./snapshot-status-badge.tsx";
import { SnapshotTree } from "./snapshot-tree.tsx";

export function SnapshotsPanel({ sandboxId, live }: { sandboxId: string; live: boolean }) {
  const { saved, name, setName, busy, error, browsing, setBrowsing, mine, save, remove } =
    useSandboxSnapshots(sandboxId);

  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="flex flex-col gap-3 p-3.5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Save a snapshot</h2>
            <p className="mt-0.5 text-base text-muted-foreground">
              A frozen copy of the disk under a name. It outlives the sandbox.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="snap-name"
              className="h-9 flex-1 text-base"
              value={name}
              placeholder={suggestName(sandboxId)}
              spellCheck={false}
              aria-label="Snapshot name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <Button
              className="h-9"
              disabled={(!live && mine.length === 0) || busy === "save"}
              onClick={() => void save()}
            >
              {busy === "save" ? <Spinner className="size-3.5" /> : <Camera className="size-3.5" />}
              Save snapshot
            </Button>
          </div>

          <p className="text-base text-muted-foreground">
            Lowercase letters, digits and dashes. Saving the same name again replaces it.
          </p>

          {error && <Notice>{error}</Notice>}
        </div>
      </Panel>

      <Panel
        title="This sandbox's snapshots"
        subtitle={mine.length ? `${mine.length} saved under this id` : undefined}
        flush
      >
        {body()}
      </Panel>
    </div>
  );

  function body() {
    if (saved.loading && !saved.data) {
      return (
        <div className="flex flex-col gap-2 p-3.5">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      );
    }

    if (mine.length === 0) {
      return (
        <EmptyState
          glyph="⧉"
          icon={<Camera className="size-4" />}
          title="No snapshots"
          hint="Save one before you delete the sandbox — the files stay recoverable."
        />
      );
    }

    return (
      <ul role="list" className="divide-y divide-border/70">
        {mine.map((snapshot) => {
          const open = browsing === snapshot.name;
          return (
            <li key={snapshot.name}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <span className="truncate text-base font-medium text-foreground">
                  {snapshot.name}
                </span>
                <SnapshotStatusBadge status={snapshot.status} />
                <span className="text-base text-muted-foreground">
                  {fmtBytes(snapshot.sizeBytes)} · {timeAgo(snapshot.createdAt)}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  {snapshot.snapshotId && snapshot.status === "ready" && (
                    <Button
                      size="sm"
                      variant={open ? "secondary" : "outline"}
                      onClick={() => setBrowsing(open ? null : snapshot.name)}
                    >
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", open && "rotate-180")}
                      />
                      {open ? "Hide files" : "Browse files"}
                    </Button>
                  )}
                  <ConfirmDialog
                    trigger={<Trash2 className="size-3.5" />}
                    triggerLabel={`Delete ${snapshot.name}`}
                    title={`Delete ${snapshot.name}?`}
                    description="The frozen disk and every share code pointing at it are destroyed."
                    confirmLabel="Delete snapshot"
                    destructive
                    busy={busy === `del:${snapshot.name}`}
                    onConfirm={() => void remove(snapshot)}
                  />
                </div>
              </div>

              {snapshot.error && (
                <p className="px-3.5 pb-2 text-base leading-relaxed text-destructive">
                  {snapshot.error}
                </p>
              )}

              {open && snapshot.snapshotId && <SnapshotTree snapshotId={snapshot.snapshotId} />}
            </li>
          );
        })}
      </ul>
    );
  }
}
