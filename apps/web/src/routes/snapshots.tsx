import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SavedSnapshotsList } from "@/modules/snapshots/components/saved-snapshots-list.tsx";

export const Route = createFileRoute("/snapshots")({
  component: SnapshotsPage,
});

function SnapshotsPage() {
  const [filter, setFilter] = useState("");
  return <SavedSnapshotsList filter={filter} onFilterChange={setFilter} />;
}
