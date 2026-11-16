import { z } from "zod";

/** Boat's inline file limit for `GET`/`PUT /files` (5 MiB). */
export const FILE_INLINE_LIMIT = 5 * 1024 * 1024;
/** Boat caps directory listings and searches at 10,000 entries. */
export const FILE_LIST_LIMIT = 10_000;

/** The two trees a sandbox exposes to its owner. */
export const SANDBOX_ROOTS = ["/home/user", "/tmp"] as const;
export const SANDBOX_WORKDIR = "/home/user";

export const FileEncoding = z.enum(["utf8", "base64"]);
export type FileEncoding = z.infer<typeof FileEncoding>;

/**
 * Resolve a client-supplied path against the work directory and require the
 * result to sit under an allowed root.
 *
 * This is a *lexical* normalisation: it stops `../` traversal, but it does not
 * resolve symlinks, so a symlink inside the sandbox that points outside these
 * trees is not detected here. `400 invalid_path` matches boat's error code.
 */
export function resolveSandboxPath(input: string): { ok: true; path: string } | { ok: false } {
  if (!input || input.includes("\0")) return { ok: false };

  const absolute = input.startsWith("/") ? input : `${SANDBOX_WORKDIR}/${input}`;
  const parts: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment === "..") {
      parts.pop();
      continue;
    }

    parts.push(segment);
  }
  const normalized = `/${parts.join("/")}`;

  const allowed = SANDBOX_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
  // The roots themselves exist but must not be deleted or mistaken for entries.
  return allowed ? { ok: true, path: normalized } : { ok: false };
}

/** A `path` field that must resolve inside the sandbox. */
const sandboxPath = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const resolved = resolveSandboxPath(value);

    if (!resolved.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid_path: must resolve under /home/user or /tmp",
      });
      return z.NEVER;
    }

    return resolved.path;
  });

export const ReadFileQuery = z
  .object({ path: sandboxPath, encoding: FileEncoding.default("utf8") })
  .strict();

export const FileWriteRequest = z
  .object({
    path: sandboxPath,
    content: z.string(),
    encoding: FileEncoding.default("utf8"),
  })
  .strict();

export const FileListQuery = z.object({ path: z.string().optional() }).strict();

export const FileInfoQuery = z.object({ path: sandboxPath }).strict();

export const FileDeleteQuery = z
  .object({
    path: sandboxPath,
    recursive: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();

export const FileFolderRequest = z
  .object({
    path: sandboxPath,
    mode: z
      .string()
      .regex(/^[0-7]{3,4}$/)
      .optional(),
  })
  .strict();

export const FileMoveRequest = z
  .object({
    source: sandboxPath,
    destination: sandboxPath,
    overwrite: z.boolean().default(false),
  })
  .strict();

export const FileSearchQuery = z
  .object({
    path: z.string().optional(),
    pattern: z.string().min(1).max(255),
  })
  .strict();

export const FileFindQuery = z
  .object({
    path: z.string().optional(),
    pattern: z.string().min(1).max(255),
    /** Case-insensitive by default, matching boat's find semantics. */
    ignoreCase: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(true),
    maxResults: z.coerce.number().int().min(1).max(1000).default(1000),
  })
  .strict();

export interface FileEntry {
  name: string;
  /** Absolute path on the sandbox. */
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  /** Octal permission bits, e.g. "0644". */
  mode: string;
  modifiedAt: string;
}

export interface FileMatch {
  file: string;
  line: number;
  content: string;
}
/** Hard ceiling for the signed-URL transfer path (buffered in memory). */
export const FILE_TRANSFER_LIMIT = 100 * 1024 * 1024;
/** Boat caps bulk replace at 100 files, 5 MiB each. */
export const FILE_REPLACE_MAX_FILES = 100;

const octalMode = z.string().regex(/^[0-7]{3,4}$/, "mode must be octal, e.g. 644");

export const FilePermissionsRequest = z.object({ path: sandboxPath, mode: octalMode }).strict();

export const FileReplaceRequest = z
  .object({
    paths: z.array(sandboxPath).min(1).max(FILE_REPLACE_MAX_FILES),
    pattern: z.string().min(1),
    /** May be "" to delete every match. */
    newValue: z.string(),
  })
  .strict();

export const FileUrlRequest = z
  .object({
    path: sandboxPath,
    ttlSeconds: z.number().int().min(1).max(3600).default(900),
  })
  .strict();

export interface FileReplaceResult {
  file: string;
  success: boolean;
  replacements?: number;
  error?: string;
}
