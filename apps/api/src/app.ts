import { Hono } from "hono";
import { cors } from "hono/cors";
import { newRequestId } from "@spaces/shared/errors";
import { apiAuth } from "./auth.ts";
import { store } from "./db.ts";
import { traceRequests } from "./modules/traces/middleware.ts";
import { startTracing } from "./modules/traces/tracer.ts";
import { isApiPath, mountConsole } from "./console.ts";
import { type ApiEnv, errorHandler, fail } from "./errors.ts";
import { emptyJsonBody } from "./json-body.ts";
import { meRouter } from "./modules/auth/me.ts";
import { authRouter } from "./modules/auth/router.ts";
import { apiKeysRouter } from "./modules/api-keys/router.ts";
import { auditRouter } from "./modules/audit/router.ts";
import { tracesRouter } from "./modules/traces/router.ts";
import { auditMutations } from "./modules/audit/middleware.ts";
import { commandsRouter } from "./modules/commands/router.ts";
import { filesRouter } from "./modules/files/router.ts";
import { machineSizesRouter } from "./modules/machine-sizes/router.ts";
import { portsRouter } from "./modules/ports/router.ts";
import { refusalsRouter } from "./modules/sandboxes/refusals.ts";
import { sandboxesRouter } from "./modules/sandboxes/router.ts";
import { savedSnapshotsRouter } from "./modules/snapshots/saved-snapshots.ts";
import { snapshotsRouter } from "./modules/snapshots/router.ts";
import { sshRouter } from "./modules/ssh/router.ts";
import { systemRouter } from "./modules/system/router.ts";
import { transfersRouter } from "./modules/transfers/router.ts";
import { usageRouter } from "./modules/usage/router.ts";

export const app = new Hono<ApiEnv>();

app.use("*", async (c, next) => {
  const requestId = newRequestId();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});

app.use("*", cors({ origin: (o) => o ?? "*", credentials: true }));
app.use("*", emptyJsonBody);
startTracing(store.insertSpans);

app.use("*", traceRequests);
app.use("/api/v1/*", apiAuth);
app.use("/api/v1/*", auditMutations);

app.route("/", systemRouter);
app.route("/api", authRouter);
app.route("/api/v1", sandboxesRouter);
app.route("/api/v1", machineSizesRouter);
app.route("/api/v1", refusalsRouter);
app.route("/api/v1", commandsRouter);
app.route("/api/v1", filesRouter);
app.route("/api/v1", snapshotsRouter);
app.route("/api/v1", savedSnapshotsRouter);
app.route("/api/v1", transfersRouter);
app.route("/api/v1", portsRouter);
app.route("/api/v1", sshRouter);
app.route("/api/v1", usageRouter);
app.route("/api/v1", meRouter);
app.route("/api/v1", apiKeysRouter);
app.route("/api/v1", auditRouter);
app.route("/api/v1", tracesRouter);

app.onError(errorHandler);

mountConsole(app);

/**
 * Unknown paths answer in the same envelope as every other failure. Without
 * this, a mistyped endpoint returns Hono's plain-text `404 Not Found` and a
 * client parsing the error body gets nothing useful — the one place the
 * contract was still leaking through.
 */
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;

  if (isApiPath(path)) {
    return fail(c, "not_found", `no route for ${c.req.method} ${path}`);
  }

  return c.text("Not Found", 404);
});
