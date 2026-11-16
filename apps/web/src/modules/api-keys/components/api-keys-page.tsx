import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { CopyButton } from "@/components/console/copy-button";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { PageHeader } from "@/components/console/page-header";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { ApiKeyEntry } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";
import { useApiKeys } from "../hooks/use-api-keys.ts";

export function ApiKeysPage() {
  const { keys, loading, error, busy, created, setCreated, create, revoke } = useApiKeys();
  const [name, setName] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="API keys" />

      <Panel
        title="Create a key"
        subtitle="Name it after where it lives, so revoking is obvious later."
        flush
      >
        <form
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const target = name.trim();

            if (!target) return;

            void create(target).then(() => setName(""));
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              className="text-base"
              value={name}
              placeholder="ci-runner"
              spellCheck={false}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!name.trim() || busy === "create"}>
            {busy === "create" ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />}
            Create key
          </Button>
        </form>

        {created && (
          <div className="border-t border-border/70 p-4">
            <Notice kind="warn">
              Shown once — only a hash is stored. Copy it into the client now, then close this.
            </Notice>
            <div className="mt-2.5 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 text-base text-foreground">
                {created}
              </code>
              <CopyButton value={created} label="Copy" />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Hide
              </Button>
            </div>
            <p className="mt-2 text-base break-all text-muted-foreground">
              curl -H "Authorization: Bearer &lt;key&gt;" {location.origin}/api/v1/sandboxes
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Keys" subtitle="Anything this account has issued." flush>
        {error && (
          <div className="p-4">
            <Notice>{error}</Notice>
          </div>
        )}

        {body()}
      </Panel>
    </div>
  );

  function body() {
    if (loading) {
      return (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      );
    }

    if (keys.length === 0) {
      return (
        <EmptyState
          icon={<KeyRound className="size-4" />}
          title="No keys yet"
          hint="Create one above and use it as a Bearer token against /api/v1."
        />
      );
    }

    return (
      <ul role="list" className="divide-y divide-border/70">
        {keys.map((entry) => (
          <ApiKeyRow
            key={entry.id}
            entry={entry}
            busy={busy === `revoke:${entry.id}`}
            onRevoke={() => void revoke(entry)}
          />
        ))}
      </ul>
    );
  }
}

function ApiKeyRow({
  entry,
  busy,
  onRevoke,
}: {
  entry: ApiKeyEntry;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="min-w-0 truncate text-base font-medium text-foreground">{entry.name}</span>
      <code className="min-w-0 text-base text-muted-foreground">{entry.start}…</code>
      {!entry.enabled && (
        <Badge variant="outline" size="xs" radius="full">
          disabled
        </Badge>
      )}
      <span className="min-w-0 basis-full break-words text-base text-muted-foreground sm:basis-auto">
        created {timeAgo(entry.createdAt)} · last used{" "}
        {entry.lastUsedAt ? timeAgo(entry.lastUsedAt) : "never"}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ConfirmDialog
          trigger={<Trash2 className="size-3.5" />}
          triggerLabel={`Revoke ${entry.name}`}
          title={`Revoke ${entry.name}?`}
          description="Clients using this key stop working immediately. Sandboxes it created stay."
          confirmLabel="Revoke"
          destructive
          busy={busy}
          onConfirm={onRevoke}
        />
      </div>
    </li>
  );
}
