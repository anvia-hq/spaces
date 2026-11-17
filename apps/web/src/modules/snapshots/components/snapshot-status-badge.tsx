import type { SavedSnapshot } from "@/lib/api.ts";
import { StatusBadge, type StatusTone } from "@/components/console/status-badge";

const TONE: Record<SavedSnapshot["status"], StatusTone> = {
  ready: "ok",
  failed: "error",
  saving: "warning",
};

export function SnapshotStatusBadge({ status }: { status: SavedSnapshot["status"] }) {
  return <StatusBadge tone={TONE[status]}>{status}</StatusBadge>;
}
