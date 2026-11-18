import { useState } from "react";
import { Plus } from "lucide-react";
import { MACHINE_SIZE_NAME } from "@spaces/shared/sandbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { NewMachineSize } from "../hooks/use-machine-size-admin.ts";

const LIMITS = {
  vcpu: { min: 1, max: 64 },
  memMib: { min: 512, max: 262_144 },
  diskGb: { min: 5, max: 2048 },
} as const;

function whole(value: string, range: { min: number; max: number }): number | null {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) return null;

  return parsed;
}

export function CreateMachineSizeDialog({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (size: NewMachineSize) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [vcpu, setVcpu] = useState("2");
  const [memMib, setMemMib] = useState("4096");
  const [diskGb, setDiskGb] = useState("51");
  const [description, setDescription] = useState("");

  const parsed = {
    vcpu: whole(vcpu, LIMITS.vcpu),
    memMib: whole(memMib, LIMITS.memMib),
    diskGb: whole(diskGb, LIMITS.diskGb),
  };
  const valid =
    MACHINE_SIZE_NAME.test(name) &&
    parsed.vcpu !== null &&
    parsed.memMib !== null &&
    parsed.diskGb !== null &&
    description.length <= 200;

  function submit() {
    if (!valid || busy) return;

    void onCreate({
      name,
      vcpu: parsed.vcpu!,
      memMib: parsed.memMib!,
      diskGb: parsed.diskGb!,
      description: description.trim() === "" ? null : description.trim(),
    }).then(() => {
      setName("");
      setDescription("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Add preset
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add a machine size</DialogTitle>
        </DialogHeader>
        <form
          id="create-machine-size"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="size-name" className="text-base font-medium text-muted-foreground">
              Name
            </Label>
            <Input
              id="size-name"
              className="text-base"
              value={name}
              placeholder="build-heavy"
              spellCheck={false}
              maxLength={32}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-base text-muted-foreground">
              Lowercase letters, digits and dashes, starting with a letter.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="size-vcpu" className="text-base font-medium text-muted-foreground">
                vCPU
              </Label>
              <Input
                id="size-vcpu"
                className="text-base"
                inputMode="numeric"
                value={vcpu}
                onChange={(event) => setVcpu(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="size-mem" className="text-base font-medium text-muted-foreground">
                MiB
              </Label>
              <Input
                id="size-mem"
                className="text-base"
                inputMode="numeric"
                value={memMib}
                onChange={(event) => setMemMib(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="size-disk" className="text-base font-medium text-muted-foreground">
                Disk GB
              </Label>
              <Input
                id="size-disk"
                className="text-base"
                inputMode="numeric"
                value={diskGb}
                onChange={(event) => setDiskGb(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="size-desc" className="text-base font-medium text-muted-foreground">
              Description <span className="font-normal text-muted-foreground/60">optional</span>
            </Label>
            <Input
              id="size-desc"
              className="text-base"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="create-machine-size" size="sm" disabled={!valid || busy}>
            {busy && <Spinner className="size-3.5" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
