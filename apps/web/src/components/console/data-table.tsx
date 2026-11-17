import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, Header, PaginationState, SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown } as const;

function HeaderCell<TData>({ header }: { header: Header<TData, unknown> }) {
  if (header.isPlaceholder) return null;

  const content = flexRender(header.column.columnDef.header, header.getContext());

  if (!header.column.getCanSort()) return content;

  const sorted = header.column.getIsSorted();
  const Icon = sorted ? SORT_ICON[sorted] : ChevronsUpDown;

  return (
    <button
      type="button"
      onClick={header.column.getToggleSortingHandler()}
      className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {content}
      <Icon className="size-3 opacity-60" aria-hidden />
    </button>
  );
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  pageSize = 25,
  onRowClick,
  className,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;
  initialSorting?: SortingState;
  pageSize?: number;
  onRowClick?: (row: TData) => void;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });

  const table = useReactTable({
    columns,
    data,
    getRowId,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const { pageIndex } = table.getState().pagination;
  const from = data.length === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(data.length, (pageIndex + 1) * pageSize);

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="h-9 px-3 text-xs font-medium text-muted-foreground"
                    >
                      <HeaderCell header={header} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {from}–{to} of {data.length}
          </span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
