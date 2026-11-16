import { Skeleton } from "@/components/console/skeleton";

export function GridSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card/40">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border/70 px-4 py-3.5 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="mt-2 h-2.5 w-52" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
