import { History, RefreshCw, ScrollText, Search } from "lucide-react";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { PageHeader } from "@/components/console/page-header";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useAuditLog } from "../hooks/use-audit-log.ts";
import { AuditGrid } from "./audit-grid.tsx";

const ANY = "__any__";

export function AuditPage() {
  const { filters, update, entries, actions, hasMore, loading, more, error, loadMore, refresh } =
    useAuditLog();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        icon={<ScrollText />}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-[190px] flex-col gap-1">
          <span className="text-base font-medium text-muted-foreground">Action</span>
          <Select
            value={filters.action || ANY}
            onValueChange={(value) => update({ action: value === ANY ? "" : String(value) })}
          >
            <SelectTrigger className="h-8 w-full text-base">
              <span className="truncate">{filters.action || "any"}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>any</SelectItem>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-[130px] flex-col gap-1">
          <span className="text-base font-medium text-muted-foreground">Result</span>
          <Select
            value={filters.result || ANY}
            onValueChange={(value) =>
              update({ result: value === ANY ? "" : (String(value) as "ok" | "error") })
            }
          >
            <SelectTrigger className="h-8 w-full text-base">
              <span className="truncate">{filters.result || "any"}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>any</SelectItem>
              <SelectItem value="ok">ok</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-base font-medium text-muted-foreground">Target id</span>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-base"
              value={filters.targetId}
              placeholder="bx_… or a snapshot name"
              aria-label="Target id"
              spellCheck={false}
              onChange={(event) => update({ targetId: event.target.value })}
            />
          </div>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      <Panel flush>
        {body()}
        {hasMore && (
          <div className="flex justify-center border-t border-border/70 p-3">
            <Button size="sm" variant="outline" onClick={loadMore} disabled={more}>
              {more && <Spinner className="size-3.5" />}
              Load more
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );

  function body() {
    if (loading) {
      return (
        <div className="flex flex-col gap-2 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
      );
    }

    if (entries.length === 0) {
      return (
        <EmptyState
          icon={<History className="size-4" />}
          title="Nothing recorded"
          hint="Changes made through this server appear here: sandboxes, snapshots, keys and sign-ins."
        />
      );
    }

    return <AuditGrid entries={entries} />;
  }
}
