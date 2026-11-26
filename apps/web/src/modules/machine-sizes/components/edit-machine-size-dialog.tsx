import { useState } from "react";
import { Pencil } from "lucide-react";
import { DEFAULT_MACHINE_SIZE, type MachineSize } from "@spaces/shared/sandbox";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { MachineSizePatch } from "../hooks/use-machine-size-admin.ts";
import {
  MachineSizeInputs,
  type MachineSizeFields,
  parseMachineSizeFields,
} from "./machine-size-fields.tsx";

function fieldsOf(size: MachineSize): MachineSizeFields {
  return {
    name: size.name,
    vcpu: String(size.vcpu),
    memMib: String(size.memMib),
    diskGb: String(size.diskGb),
    description: size.description ?? "",
  };
}

export function EditMachineSizeDialog({
  size,
  busy,
  onSave,
}: {
  size: MachineSize;
  busy: boolean;
  onSave: (patch: MachineSizePatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<MachineSizeFields>(() => fieldsOf(size));
  const parsed = parseMachineSizeFields(fields);
  const valid = parsed !== null;
  const isDefault = size.name === DEFAULT_MACHINE_SIZE;
  const diskChanged = parsed !== null && parsed.diskGb !== size.diskGb;

  function submit() {
    if (!valid || busy) return;

    void onSave(parsed!).then(() => setOpen(false));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (next) setFields(fieldsOf(size));
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Pencil className="size-3.5" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Edit {size.name}</DialogTitle>
        </DialogHeader>
        <Form
          id="edit-machine-size"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <MachineSizeInputs fields={fields} onChange={setFields} showName={false} />

          <p className="text-base text-muted-foreground">
            {isDefault && "This is the size a create falls back to, so it has to stay active. "}
            New sandboxes get these numbers, and so does the next resume of a sandbox on this preset
            {diskChanged && "; existing disks keep the size they were created with"}.
          </p>
        </Form>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="edit-machine-size" size="sm" disabled={!valid || busy}>
            {busy && <Spinner className="size-3.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
