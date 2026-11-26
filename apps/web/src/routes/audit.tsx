import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "@/modules/audit/components/audit-page.tsx";

export const Route = createFileRoute("/audit")({
  component: AuditRoute,
  staticData: { fullWidth: true },
});

function AuditRoute() {
  return <AuditPage />;
}
