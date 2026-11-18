import { Server } from "lucide-react";
import { Notice } from "@/components/console/notice";
import { MetaLine, PageHeader } from "@/components/console/page-header";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { useAuth } from "@/modules/auth/hooks/use-auth.ts";
import { type Runtimes, useRuntimes } from "../hooks/use-runtimes.ts";
import { RegisterRuntimeDialog } from "./register-runtime-dialog.tsx";
import { RuntimeRow } from "./runtime-row.tsx";
import { TokenPanel } from "./token-panel.tsx";

export function RuntimesPage() {
  const { auth } = useAuth();
  const admin = auth.status === "signed-in" && auth.user.admin;
  const runtimes = useRuntimes();
  const onlyBuiltIn = runtimes.runtimes.every((runtime) => runtime.kind === "local");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runtimes"
        icon={<Server />}
        actions={
          <>
            <MetaLine
              items={[runtimes.loading ? "loading" : `${runtimes.runtimes.length} registered`]}
            />
            {admin && (
              <RegisterRuntimeDialog busy={runtimes.busy === "create"} onCreate={runtimes.create} />
            )}
          </>
        }
      />

      <Panel
        title="Runtimes"
        subtitle="The machines sandboxes run on. A new sandbox goes to the least loaded online runtime that is not draining."
        flush
      >
        {runtimes.error && (
          <div className="p-4">
            <Notice>{runtimes.error}</Notice>
          </div>
        )}

        {!runtimes.loading && onlyBuiltIn && (
          <div className="p-4">
            <Notice kind="info">
              Only the built-in runtime is registered.{" "}
              {admin
                ? "Use Register runtime to add another machine, then start the agent on it with the token shown."
                : "An admin can register another machine."}
            </Notice>
          </div>
        )}

        {runtimes.issued && <TokenPanel issued={runtimes.issued} onHide={runtimes.clearIssued} />}

        <List runtimes={runtimes} admin={admin} />
      </Panel>
    </div>
  );
}

function List({ runtimes, admin }: { runtimes: Runtimes; admin: boolean }) {
  if (runtimes.loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <ul role="list" className="divide-y divide-border/70 border-t border-border/70">
      {runtimes.runtimes.map((runtime) => (
        <RuntimeRow key={runtime.id} runtime={runtime} admin={admin} runtimes={runtimes} />
      ))}
    </ul>
  );
}
