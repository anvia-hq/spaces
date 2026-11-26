import { createFileRoute } from "@tanstack/react-router";
import { TracesPage } from "@/modules/traces/components/traces-page.tsx";

export const Route = createFileRoute("/traces")({
  component: TracesRoute,
  staticData: { fullWidth: true },
});

function TracesRoute() {
  return <TracesPage />;
}
