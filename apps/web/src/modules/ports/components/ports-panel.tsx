import { ArrowUpRight, Globe, Link2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { CopyButton } from "@/components/console/copy-button";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Badge } from "@/components/ui/badge";
import { TONE_CLASS } from "@/components/console/tone.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { timeAgo } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { usePorts } from "../hooks/use-ports.ts";

const SUGGESTED = [3000, 5173, 8000, 8080];

export function PortsPanel({ sandboxId, live }: { sandboxId: string; live: boolean }) {
  const { ports, port, setPort, busy, error, urls, host, unhost, list, reserved } =
    usePorts(sandboxId);

  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="flex flex-col gap-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">Publish a port</h2>
              <p className="mt-0.5 text-base text-muted-foreground">
                The API proxies the URL, so it opens in a browser without an authorization header.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-base tracking-wide text-muted-foreground uppercase">
                common
              </span>
              {SUGGESTED.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!live}
                  onClick={() => {
                    setPort(String(suggestion));
                    void host(suggestion);
                  }}
                  className="h-auto rounded border-border/80 bg-card/60 px-2 py-0.5 text-base font-normal text-muted-foreground hover:border-border hover:text-foreground"
                >
                  :{suggestion}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-48">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-base text-muted-foreground">
                :
              </span>
              <Input
                id="port-input"
                className="h-9 pl-5 text-base"
                value={port}
                inputMode="numeric"
                spellCheck={false}
                aria-label="Guest port"
                placeholder="3000"
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && live && port) void host(Number(port));
                }}
                disabled={!live}
              />
            </div>
            <Button
              className="h-9"
              disabled={!live || !port || busy === `host:${Number(port)}`}
              onClick={() => void host(Number(port))}
            >
              {busy === `host:${Number(port)}` ? (
                <Spinner className="size-3.5" />
              ) : (
                <Link2 className="size-3.5" />
              )}
              Publish
            </Button>
            {!live && (
              <span className="self-center text-base text-warning">
                Resume the sandbox to publish ports.
              </span>
            )}
          </div>

          {error && <Notice>{error}</Notice>}

          <p className="text-base leading-relaxed text-muted-foreground">
            A port outside the pre-published set needs a microVM restart to add its mapping, which
            stops anything running inside. The disk is untouched.
          </p>
        </div>
      </Panel>

      <Panel
        title="Published"
        subtitle="Live mappings from a guest port to a proxied URL."
        flush
        action={
          list.length > 0 ? (
            <span className="text-base text-muted-foreground">{list.length}</span>
          ) : undefined
        }
      >
        {body()}
        {reserved.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 px-3.5 py-2 text-base text-muted-foreground",
            )}
          >
            <Globe className="size-3" />
            <span>always mapped</span>
            {reserved.map((reservedPort) => (
              <Badge
                key={reservedPort}
                variant="outline"
                className="font-normal text-muted-foreground"
              >
                :{reservedPort}
              </Badge>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );

  function body() {
    if (ports.loading && !ports.data) {
      return (
        <div className="flex flex-col gap-2 p-3.5">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      );
    }

    if (list.length === 0) {
      return (
        <EmptyState
          glyph="⇥"
          title="No ports published"
          hint={
            reserved.length > 0
              ? `Start a server in the sandbox, then publish its port. ${reserved.length} ports are already mapped and need no restart: ${reserved.join(", ")}.`
              : "Start a server inside the sandbox, then publish its port to reach it from here."
          }
        />
      );
    }

    return (
      <ul role="list" className="divide-y divide-border/70">
        {list.map((published) => {
          const url = urls[published.port];
          return (
            <li key={published.port} className="px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-base font-medium text-foreground">:{published.port}</span>
                <span aria-hidden className="text-muted-foreground/50">
                  →
                </span>
                <span className="text-base text-muted-foreground">host {published.hostPort}</span>
                <Badge
                  variant="outline"
                  className={published.access === "public" ? TONE_CLASS.warning : undefined}
                >
                  {published.access}
                </Badge>
                {published.title && (
                  <span className="text-base text-muted-foreground">{published.title}</span>
                )}
                <span className="text-base text-muted-foreground/70">
                  {timeAgo(published.createdAt)}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `host:${published.port}`}
                    onClick={() => void host(published.port)}
                  >
                    {busy === `host:${published.port}` && <Spinner className="size-3.5" />}
                    {url ? "Refresh URL" : "Get URL"}
                  </Button>
                  <ConfirmDialog
                    trigger={<Trash2 className="size-3.5" />}
                    triggerLabel={`Unpublish ${published.port}`}
                    title={`Unpublish port ${published.port}?`}
                    description="The proxied URL stops working. Whatever runs inside the sandbox keeps running."
                    confirmLabel="Unpublish"
                    destructive
                    busy={busy === `unhost:${published.port}`}
                    onConfirm={() => void unhost(published.port)}
                  />
                </div>
              </div>

              {url && (
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 text-base text-foreground">
                    {url}
                  </code>
                  <CopyButton value={url} label="" />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Open published URL"
                    nativeButton={false}
                    render={<a href={url} target="_blank" rel="noreferrer noopener" />}
                  >
                    <ArrowUpRight className="text-muted-foreground" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
}
