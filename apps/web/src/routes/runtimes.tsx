import { createFileRoute } from "@tanstack/react-router";
import { RuntimesPage } from "@/modules/runtimes/components/runtimes-page.tsx";

export const Route = createFileRoute("/runtimes")({ component: RuntimesRoute });

function RuntimesRoute() {
  return <RuntimesPage />;
}
