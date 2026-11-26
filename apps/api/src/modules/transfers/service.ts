import { config } from "../../config.ts";
import { ServiceError } from "../../errors.ts";
import { readSandboxFileRaw, writeSandboxFileRaw } from "../files/service.ts";
import { verifyTransferToken } from "../files/sign.ts";
import { SNAPSHOT_DOWNLOAD_PATH, snapshotFileEntry } from "../snapshots/service.ts";
import type { DownloadTransfer, UploadTransfer } from "./types.ts";

export async function downloadTransfer(token: string): Promise<DownloadTransfer> {
  const check = await verifyTransferToken(token, "GET");

  if (!check.ok) return check;

  if (check.claims.p.startsWith(`${SNAPSHOT_DOWNLOAD_PATH}/`)) {
    const snapshotId = check.claims.p.slice(SNAPSHOT_DOWNLOAD_PATH.length + 1);
    const entry = await snapshotFileEntry(snapshotId, "");
    return { ok: true, kind: "snapshot", snapshotId, bytes: entry.bytes };
  }

  const { bytes } = await readSandboxFileRaw(check.claims.s, check.claims.p);
  const name = check.claims.p.split("/").filter(Boolean).pop() ?? "download";
  return { ok: true, kind: "file", name, bytes };
}

export async function uploadTransfer(
  token: string,
  request: { declaredLength: number; readBody: () => Promise<Uint8Array> },
): Promise<UploadTransfer> {
  const check = await verifyTransferToken(token, "PUT");

  if (!check.ok) return check;

  if (request.declaredLength > config.transferMaxBytes) {
    throw new ServiceError("file_too_large", `upload exceeds ${config.transferMaxBytes} bytes`);
  }

  const body = await request.readBody();

  if (body.byteLength > config.transferMaxBytes) {
    throw new ServiceError("file_too_large", `upload exceeds ${config.transferMaxBytes} bytes`);
  }

  await writeSandboxFileRaw(check.claims.s, check.claims.p, body);
  return { ok: true, path: check.claims.p, size: body.byteLength };
}
