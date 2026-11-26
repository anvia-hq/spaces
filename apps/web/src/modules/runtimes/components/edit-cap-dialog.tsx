import { useState } from "react";
import { Gauge } from "lucide-react";
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

export function EditCapDialog({
  runtime,
  busy,
  onSave,
}: {
  runtime: Runtime;
  busy: boolean;
  onSave: (maxSandboxes: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState(runtime.maxSandboxes === null ? "" : String(runtime.maxSandboxes));
  const capValue = cap.trim() === "" ? null : Number(cap);
  const valid = capValue === null || (Number.isInteger(capValue) && capValue >= 1);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (next) setCap(runtime.maxSandboxes === null ? "" : String(runtime.maxSandboxes));
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="sm" aria-label={`Edit the cap of ${runtime.name}`} />}
      >
        <Gauge className="size-3.5" />
        Cap
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Max sandboxes on {runtime.name}</DialogTitle>
        </DialogHeader>
        <Form
          id={`cap-${runtime.id}`}
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();

            if (!valid) return;

            onSave(capValue);
            setOpen(false);
          }}
        >
          <Label htmlFor={`cap-input-${runtime.id}`} className="text-base text-muted-foreground">
            Leave empty for no limit
          </Label>
          <Input
            id={`cap-input-${runtime.id}`}
            className="text-base"
            inputMode="numeric"
            value={cap}
            placeholder="no limit"
            autoFocus
            onChange={(event) => setCap(event.target.value)}
          />
        </Form>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`cap-${runtime.id}`} size="sm" disabled={!valid || busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
