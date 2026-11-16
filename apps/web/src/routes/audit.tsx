import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "@/modules/audit/components/audit-page.tsx";

export const Route = createFileRoute("/audit")({
  component: AuditRoute,
  // Data-dense: the table earns every pixel, so this route skips the
  // centred content column the rest of the console uses.
  staticData: { fullWidth: true },
});

function AuditRoute() {
  return <AuditPage />;
}
