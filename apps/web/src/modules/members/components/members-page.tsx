import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import type { MachineSize } from "@spaces/shared/sandbox";
import { EmptyState } from "@/components/console/empty-state";
import { MetaLine, PageHeader } from "@/components/console/page-header";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { type Members, useMembers } from "../hooks/use-members.ts";
import { MemberRow } from "./member-row.tsx";

/**
 * Admin-only: the accounts on this deployment and the presets they own. The
 * route gates it; this page assumes the caller may act as the operator.
 */
export function MembersPage({ self }: { self: string | null }) {
  const members = useMembers();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        actions={<MetaLine items={[members.loading ? "loading" : `${members.total} accounts`]} />}
      />

      <Panel
        title="Accounts"
        subtitle="An admin acts as the operator: every preset, every sandbox, and the log that says who did it."
        flush
      >
        {members.error && (
          <div className="p-4">
            <Notice>{members.error}</Notice>
          </div>
        )}

        <Accounts members={members} self={self} />
      </Panel>

      <Panel
        title="Machine sizes"
        subtitle="What a sandbox on this deployment can be created at. Retiring keeps the sandboxes already at it."
        flush
      >
        <SizeForm members={members} />
        <SizeList sizes={members.sizes} members={members} />
      </Panel>
    </div>
  );
}

function Accounts({ members, self }: { members: Members; self: string | null }) {
  if (members.loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    );
  }

  if (members.users.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-4" />}
        title="No accounts yet"
        hint="Anybody who signs up on this deployment shows up here."
      />
    );
  }

  return (
    <ul role="list" className="divide-y divide-border/70">
      {members.users.map((user) => (
        <MemberRow key={user.id} user={user} self={self} members={members} />
      ))}
    </ul>
  );
}

function SizeForm({ members }: { members: Members }) {
  const [name, setName] = useState("");
  const [vcpu, setVcpu] = useState("2");
  const [memMib, setMemMib] = useState("2048");
  const [diskGb, setDiskGb] = useState("20");

  return (
    <form
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const target = name.trim();

        if (!target) return;

        void members
          .addSize({
            name: target,
            vcpu: Number(vcpu),
            memMib: Number(memMib),
            diskGb: Number(diskGb),
          })
          .then(() => setName(""));
      }}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="size-name">Name</Label>
        <Input
          id="size-name"
          className="text-base"
          placeholder="beefy"
          spellCheck={false}
          maxLength={32}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <NumberField id="size-vcpu" label="vCPU" value={vcpu} min={1} onChange={setVcpu} />
      <NumberField id="size-mem" label="MiB RAM" value={memMib} min={512} onChange={setMemMib} />
      <NumberField id="size-disk" label="GiB disk" value={diskGb} min={5} onChange={setDiskGb} />
      <Button type="submit" disabled={!name.trim() || members.busy === `size:${name.trim()}`}>
        <Plus className="size-3.5" />
        Add size
      </Button>
    </form>
  );
}

function SizeList({ sizes, members }: { sizes: MachineSize[]; members: Members }) {
  if (sizes.length === 0) {
    return <EmptyState title="No presets" hint="Add one above to make it choosable." />;
  }

  return (
    <ul role="list" className="divide-y divide-border/70">
      {sizes.map((size) => (
        <li key={size.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <span className="min-w-0 truncate text-base font-medium text-foreground">
            {size.name}
          </span>
          <span className="text-base text-muted-foreground">
            {size.vcpu} vCPU · {Math.round(size.memMib / 1024)} GiB · {size.diskGb} GiB disk
          </span>
          {size.description && (
            <span className="min-w-0 basis-full text-base text-muted-foreground sm:basis-auto">
              {size.description}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={size.name === "default" || members.busy === `size:${size.name}`}
              aria-label={
                size.name === "default" ? "default cannot be retired" : `Retire ${size.name}`
              }
              onClick={() => void members.retireSize(size)}
            >
              {members.busy === `size:${size.name}` ? (
                <Spinner className="size-3.5" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Retire
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex w-28 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        className="text-base"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
