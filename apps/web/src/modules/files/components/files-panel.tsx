import { ChevronRight, FolderPlus, RefreshCw } from "lucide-react";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileEntry } from "@/lib/api.ts";
import { cn } from "@/lib/utils";
import { useFiles } from "../hooks/use-files.ts";
import { FileList } from "./file-list.tsx";
import { FilePreview } from "./file-preview.tsx";

export function FilesPanel({ sandboxId, live }: { sandboxId: string; live: boolean }) {
  const {
    cwd,
    entries,
    loading,
    error,
    busy,
    open,
    setOpen,
    draft,
    setDraft,
    newFolder,
    setNewFolder,
    load,
    openFile,
    saveFile,
    makeFolder,
    remove,
    download,
    segments,
    maxPreview,
    workdir,
  } = useFiles(sandboxId, live);

  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-3 py-2">
          <nav
            aria-label="Path"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-base"
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void load(workdir)}
              className="h-auto rounded px-1.5 py-0.5 text-base font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              ~
            </Button>
            {segments.slice(1).map((segment, index) => {
              const path = `/${segments.slice(0, index + 2).join("/")}`;
              return (
                <span key={path} className="flex items-center gap-0.5">
                  <ChevronRight className="size-3 text-border" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void load(path)}
                    className="h-auto rounded px-1.5 py-0.5 text-base font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {segment}
                  </Button>
                </span>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <FolderPlus className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 w-[150px] pl-7 text-base"
                value={newFolder}
                placeholder="new-folder"
                aria-label="New folder name"
                spellCheck={false}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void makeFolder();
                }}
                disabled={!live}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!live || !newFolder.trim() || busy === "mkdir"}
              onClick={() => void makeFolder()}
            >
              Create
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh directory"
              disabled={loading}
              onClick={() => void load(cwd)}
            >
              <RefreshCw className={cn("text-muted-foreground", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {error && (
          <div className="border-b border-border/70 p-3">
            <Notice>{error}</Notice>
          </div>
        )}
        {!live && (
          <div className="border-b border-border/70 p-3">
            <Notice kind="warn">The sandbox is not running, so its files are not reachable.</Notice>
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="border-b border-border/70 lg:border-r lg:border-b-0">
            <FileList
              entries={entries}
              cwd={cwd}
              openPath={open?.path ?? null}
              loading={loading}
              busy={busy}
              onOpen={(entry: FileEntry) =>
                entry.isDir ? void load(entry.path) : void openFile(entry)
              }
              onDownload={(entry) => void download(entry)}
              onRemove={(entry) => void remove(entry)}
            />
          </div>

          <FilePreview
            open={open}
            draft={draft}
            busy={busy}
            live={live}
            maxPreview={maxPreview}
            onDraftChange={setDraft}
            onEdit={() => open && setDraft(open.content)}
            onRevert={() => setDraft(null)}
            onSave={() => void saveFile()}
            onClose={() => setOpen(null)}
          />
        </div>
      </Panel>
    </div>
  );
}
