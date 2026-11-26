import { useState } from "react";
import { Pencil } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Runtime } from "@/lib/api.ts";

const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export function RenameRuntimeDialog({
  runtime,
  busy,
  onSave,
}: {
  runtime: Runtime;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(runtime.name);
  const valid = NAME.test(name) && name !== runtime.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (next) setName(runtime.name);
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="sm" aria-label={`Rename ${runtime.name}`} />}
      >
        <Pencil className="size-3.5" />
        Rename
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Rename {runtime.name}</DialogTitle>
        </DialogHeader>
        <Form
          id={`rename-${runtime.id}`}
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();

            if (!valid) return;

            onSave(name);
            setOpen(false);
          }}
        >
          <Label htmlFor={`rename-input-${runtime.id}`} className="text-base text-muted-foreground">
            Lowercase letters, digits and dashes. Sandboxes keep their place: only the label
            changes.
          </Label>
          <Input
            id={`rename-input-${runtime.id}`}
            className="text-base"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Form>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`rename-${runtime.id}`} size="sm" disabled={!valid || busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
