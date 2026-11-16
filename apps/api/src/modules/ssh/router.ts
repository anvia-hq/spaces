import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { publicOrigin } from "../../origin.ts";
import { SshKeyRequest } from "./schema.ts";
import { configureSandboxSsh } from "./service.ts";

export const sshRouter = new Hono<ApiEnv>().post(
  "/sandboxes/:sandboxId/sshkey",
  validate("json", SshKeyRequest),
  async (c) => {
    const result = await configureSandboxSsh(
      c.req.param("sandboxId"),
      c.req.valid("json").key,
      publicOrigin(c.req.url),
    );
    const body: {
      ok: true;
      success: true;
      type: "ssh_key.configured";
      machineIp: string | null;
      sshUser: string;
      sshEndpoint: string;
      hostKey: string;
      note?: string;
      message?: string;
    } = {
      ok: true,
      success: true,
      type: "ssh_key.configured",
      machineIp: result.machineIp,
      sshUser: result.sshUser,
      sshEndpoint: result.sshEndpoint,
      hostKey: result.hostKey,
    };

    if ("note" in result && result.note) body.note = result.note;

    if (result.restartRequired) {
      body.message =
        "The microVM was restarted to publish port 22; anything running inside stopped.";
    }

    return c.json(body);
  },
);
