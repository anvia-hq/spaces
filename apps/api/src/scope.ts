import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a request is acting as, carried for the length of that request only.
 *
 * Reads that return someone else's row are filtered here rather than in fifty
 * route handlers: every sandbox, snapshot and saved snapshot is reached through
 * `store`, so one gate cannot be forgotten. Work that runs outside a request
 * (the reaper, provisioning, migrations) has no scope and sees everything.
 */
export type Scope = {
  /** Better Auth user id, or null for the operator key. */
  ownerId: string | null;
  /** The operator key sees every row, whoever created it. */
  admin: boolean;
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

  if (!scope || scope.admin) return null;

  return scope.ownerId;
}

/** Whether the current scope may see a row with this owner. */
export function canSee(ownerId: string | null): boolean {
  const scope = storage.getStore();

  if (!scope || scope.admin) return true;

  return ownerId !== null && ownerId === scope.ownerId;
}

export const operatorScope: Scope = { ownerId: null, admin: true };

export function userScope(userId: string): Scope {
  return { ownerId: userId, admin: false };
}
