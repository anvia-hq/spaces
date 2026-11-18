import { usePoll } from "@/lib/use-poll.ts";
import { api, type AuditEntry } from "@/lib/api.ts";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { timeAgo } from "@/lib/format.ts";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function RecentList({ loading, entries }: { loading: boolean; entries: AuditEntry[] }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-6 w-full rounded-md" />
        <Skeleton className="h-6 w-full rounded-md" />
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="p-4 text-base text-muted-foreground">Nothing recorded yet.</p>;
  }

  return (
    <ul role="list" className="divide-y divide-border/70">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-baseline gap-x-3 px-4 py-2 text-base">
          <span className="w-20 shrink-0 text-muted-foreground">{timeAgo(entry.at)}</span>
          <span className="min-w-0 truncate text-foreground">{entry.action}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {entry.actor.label ?? entry.actor.kind}
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">{entry.result}</span>
        </li>
      ))}
    </ul>
  );
}

export function RecentChanges() {
  const poll = usePoll(() => api.auditLog({ limit: 5 }), 20_000);
  const entries = poll.data?.entries ?? [];

  return (
    <Panel
      title="Recent changes"
      subtitle="The last five entries in the audit log."
      action={
        <Button size="sm" variant="ghost" render={<Link to="/audit" />}>
          Audit log
          <ArrowRight className="size-3.5" />
        </Button>
      }
      flush
    >
      <RecentList loading={poll.loading && !poll.data} entries={entries} />
    </Panel>
  );
}
