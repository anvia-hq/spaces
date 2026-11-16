import { createFileRoute } from "@tanstack/react-router";
import { ApiKeysPage } from "@/modules/api-keys/components/api-keys-page.tsx";

export const Route = createFileRoute("/keys")({
  component: KeysPage,
});

function KeysPage() {
  return <ApiKeysPage />;
}
