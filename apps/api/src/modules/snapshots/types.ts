export type SnapshotRowLike = {
  id: string;
  sandboxId: string;
  state: string;
  driverRef: string | null;
  manifest?: { path: string; kind: string; size?: number }[] | null;
  createdAt: Date;
};
