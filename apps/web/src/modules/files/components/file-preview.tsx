import { File as FileIcon, Pencil, Save, X } from "lucide-react";
import { CopyButton } from "@/components/console/copy-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtBytes } from "@/lib/format.ts";
import type { OpenFile } from "../types.ts";

export function FilePreview({
  open,
  draft,
  busy,
  live,
  onDraftChange,
  onEdit,
  onRevert,
  onSave,
  onClose,
  maxPreview,
}: {
  open: OpenFile | null;
  draft: string | null;
  busy: string | null;
  live: boolean;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRevert: () => void;
  onSave: () => void;
  onClose: () => void;
  maxPreview: number;
}) {
  if (!open) {
    return (
      <div className="grid min-h-[240px] place-items-center px-6 py-10 text-center">
        <div>
          <FileIcon className="mx-auto size-5 text-muted-foreground/60" />
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Select a file to read it.
            <br />
            Files over {fmtBytes(maxPreview)} download instead of opening.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-base text-muted-foreground" title={open.path}>
          {open.path}
        </span>
        <span className="shrink-0 text-base text-muted-foreground">{fmtBytes(open.size)}</span>
        <CopyButton value={open.path} label="Path" />
        <Button size="icon-sm" variant="ghost" aria-label="Close preview" onClick={onClose}>
          <X className="text-muted-foreground" />
        </Button>
      </div>

      {draft === null ? (
        <pre className="max-h-[392px] min-h-[180px] overflow-auto px-3 py-2.5 text-base leading-relaxed text-foreground/90">
          {open.content || <span className="text-muted-foreground/60">empty file</span>}
        </pre>
      ) : (
        <Textarea
          className="max-h-[392px] min-h-[180px] w-full resize-none bg-background leading-relaxed"
          value={draft}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDraftChange(e.target.value)}
          spellCheck={false}
          aria-label="File contents"
        />
      )}

      <div className="flex items-center gap-1.5 border-t border-border/70 px-3 py-2">
        {draft === null ? (
          <Button size="sm" variant="outline" disabled={!live} onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={busy === "save"} onClick={onSave}>
              <Save />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onRevert}>
              Revert
            </Button>
          </>
        )}
        <span className="ml-auto text-base text-muted-foreground">
          {draft === null ? "read-only" : "unsaved draft"}
        </span>
      </div>
    </div>
  );
}
