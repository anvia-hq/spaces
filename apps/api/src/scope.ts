import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a request is acting as, carried for the length of that request only.
 *
 * A deployment is one cluster and a cluster is one team (decision 0044), so
 * anyone who can sign in sees every row: `ownerId` is stamped on new rows as
 * attribution, and the visibility gate below answers true for a signed-in
 * person. The gate stays in one place because a deployment that serves two
 * teams re-arms it here and nowhere else. Work that runs outside a request
 * (the reaper, provisioning, migrations) has no scope and sees everything.
 */
export type Scope = {
  /** Better Auth user id, or null for the operator key. */
  ownerId: string | null;
  /** Whether reads may return rows somebody else created. */
  seesEveryRow: boolean;
};

const storage = new AsyncLocalStorage<Scope>();

export function runInScope<T>(scope: Scope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentScope(): Scope | undefined {
  return storage.getStore();
}

/** Owner to stamp on a new row; null when nobody (the operator) is acting. */
export function currentOwnerId(): string | null {
  return storage.getStore()?.ownerId ?? null;
}

/** The owner a scoped read is limited to, or null when it sees every row. */
export function scopedOwner(): string | null {
  const scope = storage.getStore();

  if (!scope || scope.seesEveryRow) return null;

  return scope.ownerId;
}

/** Whether the current scope may see a row with this owner. */
export function canSee(ownerId: string | null): boolean {
  const scope = storage.getStore();

  if (!scope || scope.seesEveryRow) return true;

  return ownerId !== null && ownerId === scope.ownerId;
}

export const operatorScope: Scope = { ownerId: null, seesEveryRow: true };

/**
 * A signed-in person. Being an admin is no longer part of visibility: the admin
 * role gates operating runtimes and machine sizes (`mayOperate`, decision 0037),
 * and nothing a read filters on.
 */
export function userScope(userId: string): Scope {
  return { ownerId: userId, seesEveryRow: true };
}
