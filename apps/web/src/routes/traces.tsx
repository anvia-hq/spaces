import { createFileRoute } from "@tanstack/react-router";
import { TracesPage } from "@/modules/traces/components/traces-page.tsx";

export const Route = createFileRoute("/traces")({
  component: TracesRoute,
  // Data-dense: the table earns every pixel, so this route skips the
  // centred content column the rest of the console uses.
  staticData: { fullWidth: true },
});

function TracesRoute() {
  return <TracesPage />;
}
