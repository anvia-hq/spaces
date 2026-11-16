import type { SandboxType } from "@spaces/shared/sandbox";
import { store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import { LIVE_STATES, requireSandbox } from "../sandboxes/service.ts";

/** Billable seconds one dollar buys, per boat's list price. */
const SECONDS_PER_DOLLAR = 100_000;

/** Rate at which each machine size consumes machine time. */
export const BILLING_MULTIPLIER: Record<SandboxType, number> = {
  small: 0.5,
  default: 1,
  large: 2,
  xlarge: 50 / 9,
};

function parseWindowPoint(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const asNumber = Number(value);

  if (Number.isFinite(asNumber) && /^\d+$/.test(value.trim())) return asNumber * 1000;

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    throw new ServiceError("invalid_query", `invalid time ${value}: use ISO 8601 or epoch seconds`);
  }

  return parsed;
}

/**
 * Running stretches, rebuilt from the event log. Only time the sandbox is up is
 * billed; a stop that was superseded by a resume still ends its stretch.
 */
async function runningStretches(sandboxId: string): Promise<[number, number][]> {
  const starts = new Set(["sandbox.ready", "sandbox.resumed"]);
  const ends = new Set(["sandbox.stopping", "sandbox.stopped", "sandbox.deleted"]);

  const stretches: [number, number][] = [];
  let open: number | null = null;

  for (const event of await store.allEvents(sandboxId)) {
    const at = event.at.getTime();

    if (Number.isNaN(at)) continue;

    if (starts.has(event.type)) {
      if (open === null) open = at;
    } else if (ends.has(event.type) && open !== null) {
      stretches.push([open, at]);
      open = null;
    }
  }

  const sandbox = await store.get(sandboxId);
  const live = sandbox && LIVE_STATES.includes(sandbox.state);

  if (open !== null) {
    if (live) stretches.push([open, Date.now()]);
    else stretches.push([open, open]);
  } else if (live && sandbox && stretches.length === 0) {
    // Still booting: bill from creation.
    const created = Date.parse(sandbox.createdAt);

    if (!Number.isNaN(created)) stretches.push([created, Date.now()]);
  }

  return stretches;
}

export async function sandboxUsage(id: string, query: { since?: string; until?: string }) {
  const sandbox = await requireSandbox(id);
  const nowMs = Date.now();
  const sinceMs = parseWindowPoint(query.since, Date.parse(sandbox.createdAt));
  const requestedUntil = parseWindowPoint(query.until, nowMs);
  // A window that ends in the future stops at now.
  const untilMs = Math.min(requestedUntil, nowMs);

  const multiplier = BILLING_MULTIPLIER[sandbox.type] ?? 1;
  let billableMs = 0;
  for (const [start, end] of await runningStretches(id)) {
    const from = Math.max(start, sinceMs);
    const to = Math.min(end, untilMs);

    if (to > from) billableMs += to - from;
  }

  const seconds = Math.round((billableMs / 1000) * multiplier);
  return {
    type: "sandbox.usage" as const,
    sandboxId: id,
    sandboxType: sandbox.type,
    billingMultiplier: multiplier,
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    seconds,
    dollars: Math.round((seconds / SECONDS_PER_DOLLAR) * 1e6) / 1e6,
    secondsPerDollar: SECONDS_PER_DOLLAR,
    running: LIVE_STATES.includes(sandbox.state) && (await store.pendingStop(id)) === null,
  };
}

/**
 * AI usage. This server proxies no model traffic, so the meter is empty rather
 * than missing: a client that polls it keeps working.
 */
export async function sandboxAiUsage(id: string) {
  await requireSandbox(id);
  const emptyTotals = {
    requests: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  return {
    sandboxId: id,
    blocked: false,
    proxied: false,
    credentialProfileId: null,
    since: new Date().toISOString().slice(0, 10),
    usage: [],
    totals: emptyTotals,
    dollars: 0,
  };
}
