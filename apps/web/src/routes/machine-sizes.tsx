import { createFileRoute } from "@tanstack/react-router";
import { MachineSizesPage } from "@/modules/machine-sizes/components/machine-sizes-page.tsx";

export const Route = createFileRoute("/machine-sizes")({ component: MachineSizesRoute });

function MachineSizesRoute() {
  return <MachineSizesPage />;
}
