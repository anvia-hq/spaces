import { useState } from "react";
import { Ban, ShieldCheck, ShieldMinus, ShieldPlus, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ManagedUser } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";
import type { Members } from "../hooks/use-members.ts";

export function MemberRow({
  user,
  self,
  members,
}: {
  user: ManagedUser;
  self: string | null;
  members: Members;
}) {
  const [reason, setReason] = useState("");
  const busy = members.busy?.endsWith(user.id) === true;
  const isSelf = self === user.id;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="min-w-0 truncate text-base font-medium text-foreground" title={user.email}>
        {user.email}
      </span>
      {isSelf && <Badge variant="outline">you</Badge>}
      {user.admin && (
        <Badge variant="secondary">
          <ShieldCheck />
          admin
        </Badge>
      )}
      {user.banned && <Badge variant="destructive">banned</Badge>}
      <span className="min-w-0 basis-full text-base text-muted-foreground sm:basis-auto">
        joined {timeAgo(user.createdAt)}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {user.admin ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void members.setRole(user, "user")}
          >
            {busy ? <Spinner className="size-3.5" /> : <ShieldMinus className="size-3.5" />}
            Demote
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void members.setRole(user, "admin")}
          >
            {busy ? <Spinner className="size-3.5" /> : <ShieldPlus className="size-3.5" />}
            Make admin
          </Button>
        )}

        {user.banned ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void members.unban(user)}
          >
            {busy ? <Spinner className="size-3.5" /> : <Undo2 className="size-3.5" />}
            Unban
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Ban ${user.email}`}
            onClick={() => void members.ban(user, reason.trim() || null)}
          >
            {busy ? <Spinner className="size-3.5" /> : <Ban className="size-3.5" />}
            Ban
          </Button>
        )}
      </div>

      {!user.banned && (
        <input
          aria-label={`Reason for banning ${user.email}`}
          className="min-w-0 basis-full rounded-md border border-border bg-background px-2 py-1 text-base text-foreground sm:basis-64"
          placeholder="reason (optional)"
          maxLength={280}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
    </li>
  );
}
