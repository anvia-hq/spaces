export type SnapshotRowLike = {
  id: string;
  sandboxId: string;
  state: string;
  driverRef: string | null;
  runtimeId: string;
  manifest?: { path: string; kind: string; size?: number }[] | null;
  createdAt: Date;
};
