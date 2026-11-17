import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-semibold tracking-heading text-foreground">No such route</h1>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        This page does not exist. The sandbox you were looking for may have been deleted.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button size="sm" nativeButton={false} render={<Link to="/" />}>
          All sandboxes
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/snapshots" />}>
          Snapshots
        </Button>
      </div>
    </div>
  );
}
