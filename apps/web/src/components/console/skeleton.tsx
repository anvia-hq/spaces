import { Skeleton as ShadSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Skeleton({ className = "" }: { className?: string }) {
  return <ShadSkeleton className={cn("rounded-md", className)} />;
}
