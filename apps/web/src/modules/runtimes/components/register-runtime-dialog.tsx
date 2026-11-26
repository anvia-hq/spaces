import { useState } from "react";
import { Plus } from "lucide-react";
import { RUNTIME_NAME } from "@spaces/shared/runtime";
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
import { Spinner } from "@/components/ui/spinner";

export function RegisterRuntimeDialog({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string, maxSandboxes: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const capValue = cap.trim() === "" ? null : Number(cap);
  const capValid = capValue === null || (Number.isInteger(capValue) && capValue >= 0);
  const valid = RUNTIME_NAME.test(name) && capValid;

  function submit() {
    if (!valid || busy) return;

    void onCreate(name, capValue).then(() => {
      setName("");
      setCap("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Register runtime
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Register runtime</DialogTitle>
        </DialogHeader>
        <Form
          id="register-runtime"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="runtime-name" className="text-base font-medium text-muted-foreground">
              Name
            </Label>
            <Input
              id="runtime-name"
              className="text-base"
              value={name}
              placeholder="eu-1"
              spellCheck={false}
              maxLength={32}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-base text-muted-foreground">
              Lowercase letters, digits and dashes, starting with a letter.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="runtime-cap" className="text-base font-medium text-muted-foreground">
              Max sandboxes <span className="font-normal text-muted-foreground/60">optional</span>
            </Label>
            <Input
              id="runtime-cap"
              className="text-base"
              inputMode="numeric"
              value={cap}
              placeholder="no limit"
              onChange={(event) => setCap(event.target.value)}
            />
          </div>
        </Form>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="register-runtime" size="sm" disabled={!valid || busy}>
            {busy && <Spinner className="size-3.5" />}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
