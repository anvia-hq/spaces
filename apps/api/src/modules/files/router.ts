import { Hono } from "hono";
import {
  FileDeleteQuery,
  FileFindQuery,
  FileFolderRequest,
  FileInfoQuery,
  FileListQuery,
  FileMoveRequest,
  FilePermissionsRequest,
  FileReplaceRequest,
  FileSearchQuery,
  FileUrlRequest,
  FileWriteRequest,
  ReadFileQuery,
  SANDBOX_WORKDIR,
} from "@spaces/shared/files";
import { type ApiEnv, validate } from "../../errors.ts";
import { publicOrigin } from "../../origin.ts";
import {
  createSandboxFolder,
  deleteSandboxPath,
  findInSandboxFiles,
  listSandboxFiles,
  mintFileTransfer,
  moveSandboxPath,
  readSandboxFile,
  readSandboxFileRaw,
  replaceInSandboxFiles,
  sandboxFileInfo,
  searchSandboxFiles,
  setSandboxPermissions,
  writeSandboxFile,
} from "./service.ts";

const FILE_ROUTE = "/sandboxes/:sandboxId/files";

export const filesRouter = new Hono<ApiEnv>()
  .get(FILE_ROUTE, validate("query", ReadFileQuery), async (c) => {
    const { path, encoding } = c.req.valid("query");
    const { bytes, size } = await readSandboxFile(c.req.param("sandboxId"), path);

    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const validUtf8 = !utf8.includes("\uFFFD");

    if (encoding === "base64" || !validUtf8) {
      return c.json({
        ok: true,
        type: "file.read",
        success: true,
        path,
        encoding: "base64",
        size,
        content: Buffer.from(bytes).toString("base64"),
      });
    }

    return c.json({
      ok: true,
      type: "file.read",
      success: true,
      path,
      encoding: "utf8",
      size,
      content: utf8,
    });
  })
  .put(FILE_ROUTE, validate("json", FileWriteRequest), async (c) => {
    const { path, content, encoding } = c.req.valid("json");
    const bytes =
      encoding === "base64"
        ? new Uint8Array(Buffer.from(content, "base64"))
        : new TextEncoder().encode(content);
    const { size } = await writeSandboxFile(c.req.param("sandboxId"), path, bytes);
    return c.json({ ok: true, type: "file.written", success: true, path, encoding, size });
  })
  .delete(FILE_ROUTE, validate("query", FileDeleteQuery), async (c) => {
    const { path, recursive } = c.req.valid("query");
    await deleteSandboxPath(c.req.param("sandboxId"), path, recursive);
    return c.json({ ok: true, type: "file.deleted", success: true, path });
  })
  .get(`${FILE_ROUTE}/list`, validate("query", FileListQuery), async (c) => {
    const path = c.req.valid("query").path ?? SANDBOX_WORKDIR;
    const result = await listSandboxFiles(c.req.param("sandboxId"), path);
    return c.json({ ok: true, type: "file.list", success: true, ...result });
  })
  .get(`${FILE_ROUTE}/info`, validate("query", FileInfoQuery), async (c) => {
    const entry = await sandboxFileInfo(c.req.param("sandboxId"), c.req.valid("query").path);
    return c.json({ ok: true, type: "file.info", success: true, ...entry });
  })
  .post(`${FILE_ROUTE}/folder`, validate("json", FileFolderRequest), async (c) => {
    const { path, mode } = c.req.valid("json");
    await createSandboxFolder(c.req.param("sandboxId"), path, mode);
    return c.json({ ok: true, type: "folder.created", success: true, path });
  })
  .post(`${FILE_ROUTE}/move`, validate("json", FileMoveRequest), async (c) => {
    const { source, destination, overwrite } = c.req.valid("json");
    await moveSandboxPath(c.req.param("sandboxId"), source, destination, overwrite);
    return c.json({
      ok: true,
      type: "file.moved",
      success: true,
      path: source,
      destination,
    });
  })
  .get(`${FILE_ROUTE}/search`, validate("query", FileSearchQuery), async (c) => {
    const { path, pattern } = c.req.valid("query");
    const result = await searchSandboxFiles(
      c.req.param("sandboxId"),
      path ?? SANDBOX_WORKDIR,
      pattern,
    );
    return c.json({ ok: true, type: "file.search", success: true, ...result });
  })
  .get(`${FILE_ROUTE}/find`, validate("query", FileFindQuery), async (c) => {
    const { path, pattern, ignoreCase, maxResults } = c.req.valid("query");
    const result = await findInSandboxFiles(
      c.req.param("sandboxId"),
      path ?? SANDBOX_WORKDIR,
      pattern,
      { ignoreCase, maxResults },
    );
    return c.json({ ok: true, type: "file.find", success: true, ...result });
  })
  .post(`${FILE_ROUTE}/permissions`, validate("json", FilePermissionsRequest), async (c) => {
    const { path, mode } = c.req.valid("json");
    await setSandboxPermissions(c.req.param("sandboxId"), path, mode);
    const entry = await sandboxFileInfo(c.req.param("sandboxId"), path);
    return c.json({ ok: true, type: "file.permissions_set", success: true, ...entry });
  })
  .post(`${FILE_ROUTE}/replace`, validate("json", FileReplaceRequest), async (c) => {
    const { paths, pattern, newValue } = c.req.valid("json");
    const { results } = await replaceInSandboxFiles(
      c.req.param("sandboxId"),
      paths,
      pattern,
      newValue,
    );
    return c.json({ ok: true, type: "file.replaced", success: true, results });
  })
  .post(`${FILE_ROUTE}/download-url`, validate("json", FileUrlRequest), async (c) => {
    const minted = await mintFileTransfer(
      c.req.param("sandboxId"),
      c.req.valid("json"),
      "GET",
      publicOrigin(c.req.url),
    );
    return c.json({ ok: true, type: "file.download_url", ...minted });
  })
  .post(`${FILE_ROUTE}/upload-url`, validate("json", FileUrlRequest), async (c) => {
    const minted = await mintFileTransfer(
      c.req.param("sandboxId"),
      c.req.valid("json"),
      "PUT",
      publicOrigin(c.req.url),
    );
    return c.json({ ok: true, type: "file.upload_url", ...minted });
  })
  .get("/sandboxes/:sandboxId/artifacts", validate("query", FileInfoQuery), async (c) => {
    const { path } = c.req.valid("query");
    const { bytes } = await readSandboxFileRaw(c.req.param("sandboxId"), path);
    return new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
    });
  });
