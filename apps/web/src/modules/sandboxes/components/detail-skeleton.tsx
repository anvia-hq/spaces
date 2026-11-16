import { Skeleton } from "@/components/console/skeleton";

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-3 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full max-w-lg" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
