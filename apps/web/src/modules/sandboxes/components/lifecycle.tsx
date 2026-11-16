import type { SandboxEvent } from "@/lib/api.ts";
import { EmptyState } from "@/components/console/empty-state";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Badge } from "@/components/reui/badge";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
} from "@/components/reui/timeline";
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
    <Timeline defaultValue={1} className="px-4 py-3">
      {list.map((event, index) => (
        <TimelineItem key={event.id} step={index + 1}>
          <TimelineHeader>
            <TimelineDate>{timeAgo(event.at)}</TimelineDate>
            <Badge variant="outline" size="sm" className="font-normal text-foreground">
              {event.type}
            </Badge>
          </TimelineHeader>
          <TimelineIndicator />
          {index < list.length - 1 && <TimelineSeparator />}
          {event.payload && Object.keys(event.payload).length > 0 && (
            <TimelineContent>
              <code className="block truncate text-base text-muted-foreground">
                {JSON.stringify(event.payload)}
              </code>
            </TimelineContent>
          )}
        </TimelineItem>
      ))}
    </Timeline>
  );
}
