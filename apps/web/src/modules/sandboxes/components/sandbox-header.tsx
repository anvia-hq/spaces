import { Link } from "@tanstack/react-router";
import type { MachineSize, Sandbox } from "@spaces/shared/sandbox";
import { ChevronLeft, Copy, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { MetaLine } from "@/components/console/page-header";
import { Notice } from "@/components/console/notice";
import { StateBadge } from "@/components/console/state-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { LIVE_STATES, api } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";

export function SandboxHeader({
  sandbox,
  size,
  busy,
  stale,
  act,
  onDelete,
  deleteOpen,
  onDeleteOpenChange,
}: {
  sandbox: Sandbox;
  size: MachineSize | undefined;
  busy: string | null;
  stale: boolean;
  act: (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;
  onDelete: () => void;
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
}) {
  const live = LIVE_STATES.includes(sandbox.state);
  const stopped = sandbox.state === "archived";
  const broken = sandbox.state === "error";
  const booting =
    sandbox.state === "provisioning" || sandbox.state === "init" || sandbox.state === "cloning";

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        All sandboxes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-base font-semibold tracking-heading text-foreground">
              {sandbox.name}
            </h1>
            <StateBadge state={sandbox.state} />
            {booting && <Spinner className="size-3.5 text-warning" />}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(sandbox.id);
                toast.success("Sandbox ID copied");
              }}
              className="group inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-card/60 px-2 py-1 text-base text-muted-foreground transition-colors hover:text-foreground"
            >
              {sandbox.id}
              <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <MetaLine
              items={[
                size
                  ? `${sandbox.type} · ${size.vcpu}c / ${size.memMib / 1024}G`
                  : `${sandbox.type} · retired`,
                sandbox.ip,
                sandbox.createdAt ? `up ${timeAgo(sandbox.createdAt)}` : null,
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {stopped && (
            <Button
              size="sm"
              disabled={busy === "resume"}
              onClick={() =>
                void act("resume", () => api.resumeSandbox(sandbox.id), "Sandbox resumed")
              }
            >
              {busy === "resume" && <Spinner className="size-3.5" />}
              Resume
            </Button>
          )}
          {broken && (
            <Button
              size="sm"
              disabled={busy === "recover"}
              title="Power-cycle the machine without touching the disk"
              onClick={() =>
                void act("recover", () => api.recoverSandbox(sandbox.id), "Sandbox recovered")
              }
            >
              {busy === "recover" && <Spinner className="size-3.5" />}
              Recover
            </Button>
          )}
          {live && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy === "stop"}
              onClick={() => void act("stop", () => api.stopSandbox(sandbox.id), "Sandbox stopped")}
            >
              {busy === "stop" && <Spinner className="size-3.5" />}
              Stop
            </Button>
          )}
          {(live || stopped) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy === "fork"}
              title="Copy the disk into a new sandbox"
              onClick={() => void act("fork", () => api.forkSandbox(sandbox.id), "Sandbox forked")}
            >
              {busy === "fork" && <Spinner className="size-3.5" />}
              Fork
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
            >
              <MoreHorizontal className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(sandbox.id);
                  toast.success("Sandbox ID copied");
                }}
              >
                Copy ID
              </DropdownMenuItem>
              {sandbox.ip && (
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(sandbox.ip!);
                    toast.success("IP copied");
                  }}
                >
                  Copy IP
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDeleteOpenChange(true)}>
                Delete sandbox
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {sandbox.error && (
        <Notice kind="error">
          <span className="font-medium">The machine reported an error:</span> {sandbox.error}
        </Notice>
      )}
      {stale && (
        <Notice kind="warn">Lost contact with the API — showing the last state it reported.</Notice>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        title={`Delete ${sandbox.name}?`}
        description="The machine and its disk are destroyed. Snapshots it produced are kept."
        confirmLabel="Delete sandbox"
        destructive
        busy={busy === "delete"}
        onConfirm={onDelete}
      />
    </div>
  );
}
