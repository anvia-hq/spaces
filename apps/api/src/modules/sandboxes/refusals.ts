import { Hono } from "hono";
import type { Handler } from "hono";
import { type ApiEnv, fail } from "../../errors.ts";

/**
 * Routes that match boat's contract but have nothing behind them here.
 * Answering with an explicit 501 beats a 404 that looks like a wrong URL, and
 * beats a fake success that a client would trust.
 */
const unsupported =
  (message: string): Handler<ApiEnv> =>
  (c) =>
    fail(c, "provider_not_configured", message);

export const refusalsRouter = new Hono<ApiEnv>()
  /** Organization features: this server has no accounts or organizations. */
  .post(
    "/sandboxes/:sandboxId/share",
    unsupported(
      "This server has no organizations: every sandbox is owned by the single API key, " +
        "so there is nobody to share with.",
    ),
  )
  .post(
    "/sandboxes/:sandboxId/unshare",
    unsupported(
      "This server has no organizations: a sandbox is never shared, so there is nothing " +
        "to make private.",
    ),
  )
  .post(
    "/sandboxes/:sandboxId/desktop",
    unsupported(
      "No desktop streaming is available: the guest has no display server, and the " +
        "preview proxy forwards plain HTTP only -- noVNC also needs WebSocket " +
        "upgrading. Use `POST /sandboxes/{id}/host` for an HTTP service.",
    ),
  )
  /** Integrated agents: this server runs no AI harness. */
  .post(
    "/sandboxes/:sandboxId/prompt",
    unsupported("No integrated AI agent is configured on this server."),
  )
  .post(
    "/sandboxes/:sandboxId/steer",
    unsupported("No integrated AI agent is configured on this server, so no turn can be steered."),
  )
  .post(
    "/sandboxes/:sandboxId/interrupt",
    unsupported(
      "No integrated AI agent is configured on this server, so there is no turn to interrupt.",
    ),
  )
  .get(
    "/sandboxes/:sandboxId/conversations",
    unsupported(
      "No integrated AI agent is configured on this server, so there are no conversations.",
    ),
  )
  .get(
    "/sandboxes/:sandboxId/prompts/:promptId",
    unsupported("No integrated AI agent is configured on this server, so there are no prompts."),
  )
  .put(
    "/sandboxes/:sandboxId/ai-access",
    unsupported("No AI proxy is configured on this server, so there is no access to grant."),
  );
