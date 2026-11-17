import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTable } from "@tanstack/react-table";
import type { ColumnDef, PaginationState, SortingState } from "@tanstack/react-table";
import type { MachineSize, Sandbox } from "@spaces/shared/sandbox";
import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { StateBadge } from "@/components/console/state-badge";
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LIVE_STATES, api } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";
import type { Act } from "../types.ts";

export function SandboxGrid({
  rows,
  sizes,
  busy,
  act,
}: {
  rows: Sandbox[];
  sizes: (name: string) => MachineSize | undefined;
  busy: string | null;
  act: Act;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "created", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [pendingDelete, setPendingDelete] = useState<Sandbox | null>(null);

  const columns = useMemo<ColumnDef<DataGridFeatures, Sandbox>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Sandbox",
        size: 260,
        enableHiding: false,
        cell: ({ row }) => {
          const sandbox = row.original;
          return (
            <div className="flex min-w-0 flex-col">
              <Link
                to="/sandboxes/$sandboxId"
                params={{ sandboxId: sandbox.id }}
                className="group/link flex items-center gap-1.5 truncate text-base font-medium text-foreground"
              >
                <span className="truncate">{sandbox.name}</span>
                <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/link:text-primary" />
              </Link>
              <span className="truncate text-base text-muted-foreground">{sandbox.id}</span>
            </div>
          );
        },
      },
      {
        id: "state",
        accessorKey: "state",
        header: "State",
        size: 110,
        cell: ({ row }) => <StateBadge state={row.original.state} />,
      },
      {
        id: "machine",
        accessorKey: "type",
        header: "Machine",
        size: 110,
        cell: ({ row }) => {
          const size = sizes(row.original.type);
          return (
            <span className="text-base text-muted-foreground">
              {size ? `${size.vcpu}c / ${size.memMib / 1024}G` : row.original.type}
            </span>
          );
        },
      },
      {
        id: "ip",
        accessorKey: "ip",
        header: "Network",
        size: 130,
        cell: ({ row }) => (
          <span className="text-base text-muted-foreground">{row.original.ip ?? "—"}</span>
        ),
      },
      {
        id: "created",
        accessorKey: "createdAt",
        header: "Created",
        size: 110,
        cell: ({ row }) => (
          <span className="text-base text-muted-foreground">{timeAgo(row.original.createdAt)}</span>
        ),
      },
      {
        id: "snapshot",
        accessorKey: "snapshotAvailable",
        header: "Snapshot",
        size: 110,
        cell: ({ row }) => {
          const sandbox = row.original;

          if (sandbox.error) {
            return (
              <span className="line-clamp-1 text-base text-destructive" title={sandbox.error}>
                {sandbox.error}
              </span>
            );
          }

          if (!sandbox.snapshotAvailable) {
            return <span className="text-base text-muted-foreground/60">none</span>;
          }

          return (
            <span className="text-base text-info">{timeAgo(sandbox.snapshotCompletedAt)}</span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 56,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const sandbox = row.original;
          const isLive = LIVE_STATES.includes(sandbox.state);
          const isStopped = sandbox.state === "archived";
          const isBroken = sandbox.state === "error";
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${sandbox.name}`}
                    />
                  }
                >
                  <MoreHorizontal className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    render={<Link to="/sandboxes/$sandboxId" params={{ sandboxId: sandbox.id }} />}
                  >
                    Open
                  </DropdownMenuItem>
                  {isLive && (
                    <DropdownMenuItem
                      disabled={busy === `stop:${sandbox.id}`}
                      onClick={() =>
                        void act(
                          `stop:${sandbox.id}`,
                          () => api.stopSandbox(sandbox.id),
                          "Sandbox stopped",
                        )
                      }
                    >
                      Stop
                    </DropdownMenuItem>
                  )}
                  {isStopped && (
                    <DropdownMenuItem
                      disabled={busy === `resume:${sandbox.id}`}
                      onClick={() =>
                        void act(
                          `resume:${sandbox.id}`,
                          () => api.resumeSandbox(sandbox.id),
                          "Sandbox resumed",
                        )
                      }
                    >
                      Resume
                    </DropdownMenuItem>
                  )}
                  {isBroken && (
                    <DropdownMenuItem
                      disabled={busy === `recover:${sandbox.id}`}
                      onClick={() =>
                        void act(
                          `recover:${sandbox.id}`,
                          () => api.recoverSandbox(sandbox.id),
                          "Sandbox recovered",
                        )
                      }
                    >
                      Recover
                    </DropdownMenuItem>
                  )}
                  {(isLive || isStopped) && (
                    <DropdownMenuItem
                      disabled={busy === `fork:${sandbox.id}`}
                      onClick={() =>
                        void act(
                          `fork:${sandbox.id}`,
                          () => api.forkSandbox(sandbox.id),
                          "Sandbox forked",
                        )
                      }
                    >
                      Fork
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void navigator.clipboard.writeText(sandbox.id);
                      toast.success("Sandbox ID copied");
                    }}
                  >
                    Copy ID
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(sandbox)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [act, busy],
  );

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: rows,
    getRowId: (row: Sandbox) => row.id,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  return (
    <DataGrid table={table} recordCount={rows.length} tableLayout={{ dense: true }}>
      <div className="flex w-full flex-col gap-2.5">
        <DataGridContainer className="rounded-xl border border-border bg-card/40">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
        <DataGridPagination />
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete sandbox?"}
        description="The machine and its disk are destroyed. Snapshots it produced are kept."
        confirmLabel="Delete sandbox"
        destructive
        busy={pendingDelete !== null && busy === `del:${pendingDelete.id}`}
        onConfirm={() => {
          const sandbox = pendingDelete;

          if (!sandbox) return;

          void act(
            `del:${sandbox.id}`,
            () => api.deleteSandbox(sandbox.id),
            "Sandbox deleted",
          ).then(() => setPendingDelete(null));
        }}
      />
    </DataGrid>
  );
}
