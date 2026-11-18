/**
 * Route template ("POST /sandboxes/:sandboxId/stop") -> action name and target.
 *
 * A route that is not listed still gets a row: the middleware falls back to the
 * method and the first segment of the template. Adding the mapping is how the
 * log becomes readable, and the UI shows the raw fallback until then.
 */
export interface RouteAction {
  action: string;
  targetType?: string;
  /** Which route param names the target. */
  targetParam?: string;
}

const ROUTES: Record<string, RouteAction> = {
  "POST /sandboxes": { action: "sandbox.create", targetType: "sandbox" },
  "PATCH /sandboxes/:sandboxId": {
    action: "sandbox.update",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "DELETE /sandboxes/:sandboxId": {
    action: "sandbox.delete",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/stop": {
    action: "sandbox.stop",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/resume": {
    action: "sandbox.resume",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/fork": {
    action: "sandbox.fork",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/recover": {
    action: "sandbox.recover",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/commands": {
    action: "sandbox.command",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "DELETE /sandboxes/:sandboxId/commands/:processId": {
    action: "sandbox.command_kill",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "PUT /sandboxes/:sandboxId/files": {
    action: "sandbox.file_write",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/files/folder": {
    action: "sandbox.file_folder",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/files/move": {
    action: "sandbox.file_move",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "DELETE /sandboxes/:sandboxId/files": {
    action: "sandbox.file_delete",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/files/permissions": {
    action: "sandbox.file_permissions",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/files/replace": {
    action: "sandbox.file_replace",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/host": {
    action: "sandbox.port_host",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "DELETE /sandboxes/:sandboxId/host/:port": {
    action: "sandbox.port_unhost",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /sandboxes/:sandboxId/sshkey": {
    action: "sandbox.ssh_key",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /saved-snapshots": { action: "snapshot.save", targetType: "snapshot" },
  "DELETE /saved-snapshots/:name": {
    action: "snapshot.delete",
    targetType: "snapshot",
    targetParam: "name",
  },
  "POST /saved-snapshots/:name/shares": {
    action: "snapshot.share_create",
    targetType: "snapshot",
    targetParam: "name",
  },
  "DELETE /saved-snapshots/:name/shares/:shareId": {
    action: "snapshot.share_revoke",
    targetType: "snapshot",
    targetParam: "name",
  },
  "DELETE /snapshots/:snapshotId": {
    action: "snapshot.delete",
    targetType: "snapshot",
    targetParam: "snapshotId",
  },
  "DELETE /sandboxes/:sandboxId/snapshots": {
    action: "snapshot.delete_all",
    targetType: "sandbox",
    targetParam: "sandboxId",
  },
  "POST /machine-sizes": { action: "machine_size.create", targetType: "machine_size" },
  "PATCH /machine-sizes/:name": {
    action: "machine_size.update",
    targetType: "machine_size",
    targetParam: "name",
  },
  "DELETE /machine-sizes/:name": {
    action: "machine_size.retire",
    targetType: "machine_size",
    targetParam: "name",
  },
  "POST /runtimes": { action: "runtime.create", targetType: "runtime" },
  "PATCH /runtimes/:runtime": {
    action: "runtime.update",
    targetType: "runtime",
    targetParam: "runtime",
  },
  "POST /runtimes/:runtime/token": {
    action: "runtime.token_rotate",
    targetType: "runtime",
    targetParam: "runtime",
  },
  "DELETE /runtimes/:runtime": {
    action: "runtime.delete",
    targetType: "runtime",
    targetParam: "runtime",
  },
  "POST /users/:userId/role": {
    action: "user.role_set",
    targetType: "user",
    targetParam: "userId",
  },
  "POST /users/:userId/ban": { action: "user.ban", targetType: "user", targetParam: "userId" },
  "DELETE /users/:userId/ban": { action: "user.unban", targetType: "user", targetParam: "userId" },
  "POST /api-keys": { action: "api_key.create", targetType: "api_key" },
  "DELETE /api-keys/:keyId": {
    action: "api_key.revoke",
    targetType: "api_key",
    targetParam: "keyId",
  },
};

export function routeAction(method: string, template: string): RouteAction {
  const known = ROUTES[`${method} ${template}`];

  if (known) return known;

  const segment = template.split("/").filter(Boolean)[0] ?? "request";
  return { action: `${segment}.${method.toLowerCase()}` };
}
