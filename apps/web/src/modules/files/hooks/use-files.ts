import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, files as filesApi, type FileEntry } from "@/lib/api.ts";
import type { OpenFile } from "../types.ts";

const WORKDIR = "/home/user";
const MAX_PREVIEW = 512 * 1024;

function byDirectoryFirst(a: FileEntry, b: FileEntry): number {
  if (a.isDir === b.isDir) return a.name.localeCompare(b.name);

  return a.isDir ? -1 : 1;
}

export function useFiles(sandboxId: string, live: boolean) {
  const [cwd, setCwd] = useState(WORKDIR);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [open, setOpen] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await filesApi.list(sandboxId, path);
        setEntries([...res.files].sort(byDirectoryFirst));
        setCwd(res.path);
      } catch (e) {
        setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [sandboxId],
  );

  useEffect(() => {
    if (live) void load(WORKDIR);
  }, [live, load]);

  async function openFile(entry: FileEntry) {
    setError(null);
    setBusy(`open:${entry.path}`);
    try {
      if (entry.size > MAX_PREVIEW) {
        const { url } = await filesApi.downloadUrl(sandboxId, entry.path);
        window.open(url, "_blank", "noopener");
        return;
      }

      const res = await filesApi.read(sandboxId, entry.path);
      setOpen({ path: entry.path, name: entry.name, content: res.content, size: res.size });
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveFile() {
    if (!open || draft === null) return;

    setBusy("save");
    setError(null);
    try {
      await filesApi.write(sandboxId, open.path, draft);
      setOpen({ ...open, content: draft, size: new Blob([draft]).size });
      setDraft(null);
      await load(cwd);
      toast.success(`${open.name} saved`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function makeFolder() {
    const name = newFolder.trim();

    if (!name) return;

    setBusy("mkdir");
    setError(null);
    try {
      await filesApi.folder(sandboxId, `${cwd}/${name}`);
      setNewFolder("");
      await load(cwd);
      toast.success(`Created ${name}`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: FileEntry) {
    setBusy(`del:${entry.path}`);
    setError(null);
    try {
      await filesApi.remove(sandboxId, entry.path, entry.isDir);

      if (open?.path === entry.path) setOpen(null);

      await load(cwd);
      toast.success(`${entry.name} deleted`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function download(entry: FileEntry) {
    try {
      const { url } = await filesApi.downloadUrl(sandboxId, entry.path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    }
  }

  return {
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
    segments: cwd.split("/").filter(Boolean),
    maxPreview: MAX_PREVIEW,
    workdir: WORKDIR,
  };
}
