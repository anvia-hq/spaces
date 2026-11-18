import { createFileRoute } from "@tanstack/react-router";
import { ClusterPage } from "@/modules/runtimes/components/cluster-page.tsx";

export const Route = createFileRoute("/runtimes")({ component: RuntimesRoute });

function RuntimesRoute() {
  return <ClusterPage />;
}
