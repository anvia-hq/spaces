import { File, Folder } from "lucide-react";

export function EntryIcon({ isDir }: { isDir: boolean }) {
  const Icon = isDir ? Folder : File;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}
