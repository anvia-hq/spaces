import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CopyButton } from "@/components/console/copy-button";
import { DataTable } from "@/components/console/data-table";
import { StatusBadge } from "@/components/console/status-badge";
import type { AuditEntry } from "@/lib/api.ts";
import { fmtDuration, timeAgo } from "@/lib/format.ts";
import { cn } from "@/lib/utils";

/**
 * The audit log as a table.
 *
 * Rows used to be flex containers with a `break-all` blob in the middle, which
 * at full width produced a single unreadable column of joined text. Columns
 * give each fact a home: what happened, who did it, to what, and how it ended.
 */
export function AuditGrid({ entries }: { entries: AuditEntry[] }) {
  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        id: "at",
        accessorKey: "at",
        header: "Time",
        size: 110,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{timeAgo(row.original.at)}</span>
        ),
      },
      {
        id: "action",
        accessorKey: "action",
        header: "Action",
        size: 220,
        cell: ({ row }) => <span className="text-foreground">{row.original.action}</span>,
      },
      {
        id: "actor",
        accessorKey: "actor.label",
        header: "Actor",
        size: 200,
        cell: ({ row }) => {
          const { actor } = row.original;

          return (
            <span className="block truncate text-foreground" title={actor.label ?? actor.kind}>
              {actor.label ?? actor.kind}
            </span>
          );
        },
      },
      {
        id: "target",
        accessorKey: "target.id",
        header: "Target",
        size: 260,
        cell: ({ row }) => {
          const { target, metadata } = row.original;
          const name = typeof metadata.name === "string" ? metadata.name : null;
          const label = [target.type, name ?? target.id].filter(Boolean).join(" ");

          if (!target.id) return <span className="text-muted-foreground">—</span>;

          return (
            <span className="block truncate text-foreground" title={label}>
              {label}
            </span>
          );
        },
      },
      {
        id: "result",
        accessorKey: "result",
        header: "Result",
        size: 90,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge tone={row.original.result === "ok" ? "ok" : "error"}>
              {row.original.result}
            </StatusBadge>
            {row.original.status !== null && (
              <span className="text-muted-foreground">{row.original.status}</span>
            )}
          </div>
        ),
      },
      {
        id: "duration",
        accessorKey: "durationMs",
        header: () => <div className="text-right">Took</div>,
        size: 90,
        cell: ({ row }) => {
          const { durationMs } = row.original;

          if (durationMs === null) return <span className="text-muted-foreground">—</span>;

          return (
            <div
              className={cn(
                "text-right",
                durationMs > 1000 ? "text-warning" : "text-muted-foreground",
              )}
            >
              {fmtDuration(durationMs / 1000)}
            </div>
          );
        },
      },
      {
        id: "origin",
        accessorKey: "ip",
        header: "From",
        size: 180,
        cell: ({ row }) => {
          const { ip, requestId, errorCode } = row.original;

          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-muted-foreground">{ip ?? "—"}</span>
              {errorCode && <span className="text-destructive">{errorCode}</span>}
              {requestId && <CopyButton value={requestId} label="request id" />}
            </div>
          );
        },
      },
    ],
    [],
  );

  return <DataTable columns={columns} data={entries} getRowId={(row) => row.id} pageSize={25} />;
}
