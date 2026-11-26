import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { DataTable } from "@/components/console/data-table";
import { StatusBadge } from "@/components/console/status-badge";
import { fmtDuration, timeAgo } from "@/lib/format.ts";
import type { TraceSummary } from "@/lib/api.ts";

export function TracesGrid({
  traces,
  onOpen,
}: {
  traces: TraceSummary[];
  onOpen: (trace: TraceSummary) => void;
}) {
  const columns = useMemo<ColumnDef<TraceSummary, unknown>[]>(
    () => [
      {
        id: "route",
        accessorKey: "route",
        header: "Request",
        size: 420,
        enableHiding: false,
        cell: ({ row }) => {
          const trace = row.original;
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
              <span className="truncate text-base text-foreground">
                {trace.route ?? trace.rootName}
              </span>
            </div>
          );
        },
      },
      {
        id: "method",
        accessorKey: "method",
        header: "Method",
        size: 90,
        cell: ({ row }) => (
          <span className="text-base text-muted-foreground">{row.original.method ?? "—"}</span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 100,
        cell: ({ row }) => (
          <StatusBadge tone={row.original.status === "error" ? "error" : "ok"}>
            {row.original.status}
          </StatusBadge>
        ),
      },
      {
        id: "duration",
        accessorKey: "durationMs",
        header: () => <div className="text-right">Duration</div>,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-base text-foreground">
            {fmtLatency(row.original.durationMs)}
          </div>
        ),
      },
      {
        id: "spans",
        accessorKey: "spanCount",
        header: () => <div className="text-right">Spans</div>,
        size: 90,
        cell: ({ row }) => (
          <div className="text-right text-base text-muted-foreground">{row.original.spanCount}</div>
        ),
      },
      {
        id: "started",
        accessorKey: "startedAt",
        header: () => <div className="text-right">Started</div>,
        size: 110,
        cell: ({ row }) => (
          <div className="text-right text-base text-muted-foreground">
            {timeAgo(row.original.startedAt)}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={traces}
      getRowId={(row) => row.traceId}
      onRowClick={onOpen}
      pageSize={25}
    />
  );
}

export function fmtLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  return fmtDuration(ms / 1000);
}
