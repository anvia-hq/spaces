import { newId } from "@spaces/shared/errors";
import { config } from "../../config.ts";
import { now, store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import { mintTransferToken } from "../files/sign.ts";
import { allocateHostPort, bindOf, portRangeOf } from "../sandboxes/host-ports.ts";
import { requireLiveSandbox, requireSandbox } from "../sandboxes/service.ts";
import { driverOfSandbox, requireRuntime } from "../runtimes/service.ts";
import type { HostedPort } from "./types.ts";

export function previewPath(guestPort: number): string {
  return `/preview/${guestPort}`;
}

export async function hostSandboxPort(
  id: string,
  request: { port: number; public?: boolean; localhost?: boolean; title?: string },
  origin: string,
): Promise<HostedPort> {
  const { sandbox, driver } = await requireLiveSandbox(id);
  const runtime = await requireRuntime(sandbox.runtimeId);
  const range = portRangeOf(runtime);

  if (!range) {
    throw new ServiceError(
      "provider_not_configured",
      runtime.kind === "local"
        ? "Port publishing is disabled on this server (SPACES_PORT_RANGE_START=0)."
        : `Port publishing is disabled on runtime ${runtime.name} (no port range advertised).`,
    );
  }

  const bind = bindOf(runtime);
  const archived = sandbox.state === "archived";
  let restarted = false;

  const existing = await store.getPort(id, request.port);
  let row = existing;

  if (!row) {
    if (archived) {
      throw new ServiceError(
        "sandbox_not_ready",
        `sandbox is archived; resume it before hosting port ${request.port}`,
      );
    }

    const hostPort = await allocateHostPort(runtime);

    if (hostPort === null) {
      throw new ServiceError(
        "provider_not_configured",
        `No free host port in ${range.start}-${range.end} on runtime ${runtime.name}.`,
      );
    }

    try {
      await driver.publishPort(id, { bind, hostPort, guestPort: request.port }, "restart");
      restarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceError("internal", `failed to publish port ${request.port}: ${message}`);
    }
    await store.insertPort({
      id: newId("prt"),
      sandboxId: id,
      guestPort: request.port,
      hostPort,
      bind,
      title: request.title ?? null,
      public: request.public ?? false,
      localhost: request.localhost ?? false,
      explicit: true,
      createdAt: now(),
    });
    row = await store.getPort(id, request.port)!;
  } else {
    await store.updatePort(row.id, {
      localhost: request.localhost ?? row.localhost,
      public: request.public ?? row.public,
      title: request.title ?? row.title,
      explicit: true,
    });
    row = await store.getPort(id, request.port);
  }

  if (!row) throw new ServiceError("internal", `no port row for ${request.port}`);

  const token = await mintTransferToken({
    m: "GET",
    s: id,
    p: previewPath(request.port),
    e: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  });

  const base = config.previewHost || origin;
  const suffix = row.public ? "" : `?_token=${token}`;
  return {
    port: request.port,
    hostPort: row.hostPort,
    url: `${base.replace(/\/$/, "")}/api/v1/_preview/${id}/${request.port}${suffix}`,
    token,
    isProtected: !row.public,
    access: row.public ? "public" : "private",
    title: row.title,
    localhost: row.localhost,
    restartRequired: restarted,
  };
}

export async function unhostSandboxPort(id: string, guestPort: number) {
  const row = await store.getPort(id, guestPort);

  if (!row) throw new ServiceError("not_found", `port ${guestPort} is not published`);

  const driver = await driverOfSandbox(id);
  await driver
    .unpublishPort(id, { hostPort: row.hostPort, guestPort: row.guestPort })
    .catch(() => {});
  await driver.forgetPort(row.hostPort).catch(() => {});
  await store.deletePort(row.id);
  return { port: guestPort, hostPort: row.hostPort, status: "unhosted" as const };
}

export async function listHostedPorts(id: string) {
  await requireSandbox(id);
  return (await store.listPorts(id)).map((row) => ({
    port: row.guestPort,
    hostPort: row.hostPort,
    explicit: row.explicit,
    title: row.title,
    access: row.public ? ("public" as const) : ("private" as const),
    isProtected: !row.public,
    localhost: row.localhost,
    createdAt: row.createdAt,
  }));
}

export async function resolvePreview(sandboxId: string, guestPort: number) {
  const row = await store.getPort(sandboxId, guestPort);

  if (!row) {
    throw new ServiceError("not_found", `port ${guestPort} is not published for ${sandboxId}`);
  }

  return row;
}
