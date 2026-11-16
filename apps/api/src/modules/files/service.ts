import { config } from "../../config.ts";
import { ServiceError } from "../../errors.ts";
import { driver } from "../driver/service.ts";
import { requireLiveSandbox } from "../sandboxes/service.ts";
import { mintTransferToken } from "./sign.ts";
import type { TransferMethod } from "./types.ts";

/** Boat's inline limit; larger transfers need the URL endpoints we do not serve. */
export const INLINE_LIMIT = 5 * 1024 * 1024;

/** Shared read path; `limit` differs between the inline and signed-URL routes. */
async function readBytes(id: string, path: string, limit: number, label: string) {
  const { ref } = await requireLiveSandbox(id);
  const info = await driver().fileInfo(ref, path);

  if (info.isDir) throw new ServiceError("invalid_path", `path is a directory: ${path}`);

  if (info.size > limit) {
    throw new ServiceError(
      "file_too_large",
      `file_too_large: ${info.size} bytes exceeds the ${limit} byte ${label} limit`,
    );
  }

  return { bytes: await driver().readFile(ref, path), size: info.size };
}

async function writeBytes(
  id: string,
  path: string,
  bytes: Uint8Array,
  limit: number,
  label: string,
) {
  if (bytes.byteLength > limit) {
    throw new ServiceError(
      "file_too_large",
      `file_too_large: ${bytes.byteLength} bytes exceeds the ${limit} byte ${label} limit`,
    );
  }

  const { ref } = await requireLiveSandbox(id);
  await driver().writeFile(ref, path, bytes);
  return { size: bytes.byteLength };
}

/** Inline route: capped at 5 MiB, like boat's `GET`/`PUT /files`. */
export async function readSandboxFile(id: string, path: string) {
  return readBytes(id, path, INLINE_LIMIT, "inline read");
}

export async function writeSandboxFile(id: string, path: string, bytes: Uint8Array) {
  return writeBytes(id, path, bytes, INLINE_LIMIT, "inline write");
}

/** Signed-URL route: boat promises no size limit here, so only the transfer cap applies. */
export async function readSandboxFileRaw(id: string, path: string) {
  return readBytes(id, path, config.transferMaxBytes, "transfer");
}

export async function writeSandboxFileRaw(id: string, path: string, bytes: Uint8Array) {
  return writeBytes(id, path, bytes, config.transferMaxBytes, "transfer");
}

export async function listSandboxFiles(id: string, path: string) {
  const { ref } = await requireLiveSandbox(id);
  const files = await driver().listFiles(ref, path);
  const truncated = files.length > 10_000;
  return { path, files: truncated ? files.slice(0, 10_000) : files, truncated };
}

export async function sandboxFileInfo(id: string, path: string) {
  const { ref } = await requireLiveSandbox(id);
  return driver().fileInfo(ref, path);
}

export async function createSandboxFolder(id: string, path: string, mode?: string) {
  const { ref } = await requireLiveSandbox(id);
  await driver().makeFolder(ref, path, mode);
  return { path };
}

export async function moveSandboxPath(
  id: string,
  source: string,
  destination: string,
  overwrite: boolean,
) {
  const { ref } = await requireLiveSandbox(id);
  await driver().movePath(ref, source, destination, overwrite);
  return { source, destination };
}

export async function deleteSandboxPath(id: string, path: string, recursive: boolean) {
  const { ref } = await requireLiveSandbox(id);
  await driver().removePath(ref, path, recursive);
  return { path };
}

export async function searchSandboxFiles(id: string, path: string, pattern: string) {
  const { ref } = await requireLiveSandbox(id);
  const files = await driver().searchFiles(ref, path, pattern);
  const truncated = files.length > 10_000;
  return { files: truncated ? files.slice(0, 10_000) : files, truncated };
}

export async function findInSandboxFiles(
  id: string,
  path: string,
  pattern: string,
  options: { ignoreCase: boolean; maxResults: number },
) {
  const { ref } = await requireLiveSandbox(id);
  return driver().findInFiles(ref, path, pattern, options);
}

/** Throws unless the sandbox is running; used to reject dead transfer links early. */
export async function assertSandboxLive(id: string): Promise<void> {
  await requireLiveSandbox(id);
}

export async function setSandboxPermissions(id: string, path: string, mode: string) {
  const { ref } = await requireLiveSandbox(id);
  await driver().setPermissions(ref, path, mode);
  return { path, mode };
}

/**
 * Bulk literal text replacement. Boat treats `pattern` as plain text (not a
 * regex) and replaces every occurrence byte-for-byte, so this runs host-side
 * over the file endpoints rather than trying to express it in shell.
 *
 * One file failing does not stop the others.
 */
export async function replaceInSandboxFiles(
  id: string,
  paths: string[],
  pattern: string,
  newValue: string,
): Promise<{
  results: { file: string; success: boolean; replacements?: number; error?: string }[];
}> {
  const results: { file: string; success: boolean; replacements?: number; error?: string }[] = [];

  for (const path of paths) {
    try {
      const info = await sandboxFileInfo(id, path);

      if (info.isDir) {
        results.push({ file: path, success: false, error: "is a directory" });
        continue;
      }

      if (info.size > INLINE_LIMIT) {
        results.push({ file: path, success: false, error: "file_too_large" });
        continue;
      }

      const { bytes } = await readSandboxFile(id, path);
      const text = new TextDecoder("utf-8").decode(bytes);
      const occurrences = countOccurrences(text, pattern);

      if (occurrences === 0) {
        results.push({ file: path, success: true, replacements: 0 });
        continue;
      }

      const replaced = text.split(pattern).join(newValue);
      const out = new TextEncoder().encode(replaced);

      if (out.byteLength > INLINE_LIMIT) {
        results.push({ file: path, success: false, error: "result_too_large" });
        continue;
      }

      await writeSandboxFile(id, path, out);
      results.push({ file: path, success: true, replacements: occurrences });
    } catch (error) {
      results.push({
        file: path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * A signed URL for one path: `GET` downloads, `PUT` uploads. Minting fails fast
 * for a download of a missing path rather than handing out a dead link.
 */
export async function mintFileTransfer(
  sandboxId: string,
  request: { path: string; ttlSeconds: number },
  method: TransferMethod,
  origin: string,
) {
  if (method === "GET") await sandboxFileInfo(sandboxId, request.path);
  else assertSandboxLive(sandboxId);

  const expiresAt = new Date(Date.now() + request.ttlSeconds * 1000).toISOString();
  const token = await mintTransferToken({
    m: method,
    s: sandboxId,
    p: request.path,
    e: Math.floor(Date.now() / 1000) + request.ttlSeconds,
  });
  return { url: `${origin}/api/v1/_transfer/${token}`, method, path: request.path, expiresAt };
}
