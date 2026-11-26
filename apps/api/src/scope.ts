import { AsyncLocalStorage } from "node:async_hooks";

export type Scope = {
  ownerId: string | null;
  seesEveryRow: boolean;
};

const storage = new AsyncLocalStorage<Scope>();

export function runInScope<T>(scope: Scope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentScope(): Scope | undefined {
  return storage.getStore();
}

export function currentOwnerId(): string | null {
  return storage.getStore()?.ownerId ?? null;
}

export function scopedOwner(): string | null {
  const scope = storage.getStore();

  if (!scope || scope.seesEveryRow) return null;

  return scope.ownerId;
}

export function canSee(ownerId: string | null): boolean {
  const scope = storage.getStore();

  if (!scope || scope.seesEveryRow) return true;

  return ownerId !== null && ownerId === scope.ownerId;
}

export const operatorScope: Scope = { ownerId: null, seesEveryRow: true };

export function userScope(userId: string): Scope {
  return { ownerId: userId, seesEveryRow: true };
}
