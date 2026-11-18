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
import { Spinner } from "@/components/ui/spinner";
import type { NewMachineSize } from "../hooks/use-machine-size-admin.ts";
import {
  EMPTY_FIELDS,
  MachineSizeInputs,
  type MachineSizeFields,
  parseMachineSizeFields,
} from "./machine-size-fields.tsx";

export function CreateMachineSizeDialog({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (size: NewMachineSize) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<MachineSizeFields>(EMPTY_FIELDS);
  const parsed = parseMachineSizeFields(fields);
  const valid = MACHINE_SIZE_NAME.test(fields.name) && parsed !== null;

  function submit() {
    if (!valid || busy) return;

    void onCreate({ name: fields.name, ...parsed! }).then(() => {
      setFields(EMPTY_FIELDS);
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
          <MachineSizeInputs fields={fields} onChange={setFields} showName />
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
