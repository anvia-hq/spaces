import type { SandboxEvent } from "@/lib/api.ts";
import { EmptyState } from "@/components/console/empty-state";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function Lifecycle({ sandboxId, createdAt }: { sandboxId: string; createdAt: string }) {
  const events = usePoll(() => api.events(sandboxId), 4000);
  const list = (events.data?.events ?? []).slice().reverse().slice(0, 6);

  return (
    <Panel title="Lifecycle" subtitle="What the runtime did, newest first." flush>
      <LifecycleBody
        loading={events.loading}
        loaded={events.data !== null}
        list={list}
        createdAt={createdAt}
      />
    </Panel>
  );
}

function LifecycleBody({
  loading,
  loaded,
  list,
  createdAt,
}: {
  loading: boolean;
  loaded: boolean;
  list: SandboxEvent[];
  createdAt: string;
}) {
  if (loading && !loaded) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return <EmptyState glyph="≡" title="No events" hint={`Created ${timeAgo(createdAt)}.`} />;
  }

  return (
    <ol className="flex flex-col px-4 py-3">
      {list.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                index === 0 ? "bg-primary" : "bg-muted-foreground/40",
              )}
            />
            {index < list.length - 1 && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="font-normal text-foreground">
                {event.type}
              </Badge>
              <time className="shrink-0 text-sm text-muted-foreground">{timeAgo(event.at)}</time>
            </div>
            {event.payload && Object.keys(event.payload).length > 0 && (
              <code className="mt-1.5 block truncate text-base text-muted-foreground">
                {JSON.stringify(event.payload)}
              </code>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
