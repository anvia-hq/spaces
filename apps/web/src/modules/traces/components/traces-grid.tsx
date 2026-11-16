import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/console/status-badge";
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { fmtDuration, timeAgo } from "@/lib/format.ts";
import type { TraceSummary } from "@/lib/api.ts";

/**
 * Traces as a table, not as a list of flex rows.
 *
 * The previous version was a `<ul>` where each row was a flex container, so
 * every column started wherever the previous cell ended: at full width the
 * method sat against the left edge and the duration against the right, with
 * the route floating somewhere between. A grid gives fixed column widths,
 * headers, and numbers that line up down the column.
 */
export function TracesGrid({
  traces,
  onOpen,
}: {
  traces: TraceSummary[];
  onOpen: (trace: TraceSummary) => void;
}) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });

  const columns = useMemo<ColumnDef<DataGridFeatures, TraceSummary>[]>(
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

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: traces,
    getRowId: (row: TraceSummary) => row.traceId,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  return (
    <DataGrid
      table={table}
      recordCount={traces.length}
      tableLayout={{ dense: true }}
      onRowClick={(trace: TraceSummary) => onOpen(trace)}
    >
      <div className="flex w-full flex-col gap-2.5">
        <DataGridContainer className="rounded-xl border border-border bg-card/40">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
        <DataGridPagination />
      </div>
    </DataGrid>
  );
}

/** Milliseconds under a second, `fmtDuration` above it. */
export function fmtLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  return fmtDuration(ms / 1000);
}
