import { CopyButton } from "@/components/console/copy-button";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { timeAgo } from "@/lib/format.ts";
import { useShares } from "../hooks/use-shares.ts";

export function Shares({ name }: { name: string }) {
  const { list, busy, code, create, revoke } = useShares(name);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-foreground">Share codes</span>
        <span className="text-base text-muted-foreground">{list.length}</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy && <Spinner className="size-3.5" />}
          Create code
        </Button>
      </div>

      {code && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-2">
          <p className="mb-1.5 text-base text-warning">
            Shown once — only a hash is stored. Copy it now.
          </p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate text-base break-all text-foreground">
              {code}
            </code>
            <CopyButton value={code} label="Copy" />
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p className="py-1 text-base text-muted-foreground">No codes yet.</p>
      ) : (
        <ul role="list" className="divide-y divide-border/60">
          {list.map((share) => (
            <li key={share.id} className="flex items-center gap-2 py-1.5">
              <code className="text-base text-foreground/90">{share.codePrefix}…</code>
              <Badge
                variant={share.status === "active" ? "primary-light" : "outline"}
                size="xs"
                radius="full"
              >
                {share.status}
              </Badge>
              <span className="text-base text-muted-foreground">used {share.useCount}×</span>
              <span className="ml-auto text-base text-muted-foreground">
                {timeAgo(share.createdAt)}
              </span>
              {share.status === "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void revoke(share)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
