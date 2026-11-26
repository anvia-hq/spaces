import { Download, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { EmptyState } from "@/components/console/empty-state";
import { Skeleton } from "@/components/console/skeleton";
import { Button } from "@/components/ui/button";
import type { FileEntry } from "@/lib/api.ts";
import { fmtBytes } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { EntryIcon } from "@/components/console/entry-icon";

export function FileList({
  entries,
  cwd,
  openPath,
  loading,
  busy,
  onOpen,
  onDownload,
  onRemove,
}: {
  entries: FileEntry[];
  cwd: string;
  openPath: string | null;
  loading: boolean;
  busy: string | null;
  onOpen: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onRemove: (entry: FileEntry) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      {renderRows()}
      <div className="border-t border-border/70 px-3 py-1.5 text-base text-muted-foreground">
        {entries.length} entr{entries.length === 1 ? "y" : "ies"} in {cwd}
      </div>
    </div>
  );

  function renderRows() {
    if (loading && entries.length === 0) {
      return (
        <div className="flex flex-col gap-1.5 p-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
      );
    }

    if (entries.length === 0) {
      return (
        <EmptyState
          glyph="▤"
          title="Empty directory"
          hint="Write a file in the Terminal tab, or create a folder here."
        />
      );
    }

    return (
      <ul role="list" className="max-h-[440px] divide-y divide-border/60 overflow-auto">
        {entries.map((entry) => {
          const active = openPath === entry.path;
          return (
            <li
              key={entry.path}
              className={cn(
                "group flex items-center gap-2.5 px-3 py-1.5 transition-colors hover:text-foreground",
                active && "bg-accent/60",
              )}
            >
              <EntryIcon isDir={entry.isDir} />
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpen(entry)}
                disabled={busy === `open:${entry.path}`}
                className="h-auto min-w-0 flex-1 justify-start gap-0 px-0 py-0 text-left text-base font-normal text-foreground/90 hover:bg-transparent hover:text-primary"
                title={entry.path}
              >
                <span className="min-w-0 truncate">
                  {entry.name}
                  {entry.isDir && <span className="text-muted-foreground">/</span>}
                </span>
              </Button>
              <span className="hidden shrink-0 text-base text-muted-foreground/70 sm:inline">
                {entry.mode}
              </span>
              <span className="w-14 shrink-0 text-right text-base text-muted-foreground">
                {entry.isDir ? "—" : fmtBytes(entry.size)}
              </span>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Download ${entry.name}`}
                  onClick={() => onDownload(entry)}
                >
                  <Download className="text-muted-foreground" />
                </Button>
                <ConfirmDialog
                  trigger={<Trash2 className="size-3" />}
                  triggerLabel={`Delete ${entry.name}`}
                  title={`Delete ${entry.name}?`}
                  description={
                    entry.isDir
                      ? "The folder and everything inside it is removed from the sandbox disk."
                      : "The file is removed from the sandbox disk."
                  }
                  confirmLabel="Delete"
                  destructive
                  busy={busy === `del:${entry.path}`}
                  onConfirm={() => onRemove(entry)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
}
