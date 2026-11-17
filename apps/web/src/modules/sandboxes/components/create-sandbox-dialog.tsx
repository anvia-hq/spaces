import { useEffect, useState } from "react";
import type { MachineSize, SandboxType } from "@spaces/shared/sandbox";
import { Check } from "lucide-react";
import { Segmented } from "@/components/console/segmented";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const TTL_CHOICES = [
  { value: "900", label: "15 min" },
  { value: "3600", label: "1 hour" },
  { value: "28800", label: "8 hours" },
  { value: "none", label: "Never" },
] as const;

/**
 * Creating a sandbox is a decision, not a destination: four fields, then it
 * closes. A dialog keeps the fleet behind it, so the new machine lands in the
 * list you were already reading instead of replacing the page.
 *
 * Layout follows the order you actually decide in — how big, how long, what to
 * call it — with each choice visible at once. Auto-stop is a segmented row
 * rather than a select because a nested popover inside a dialog is two clicks
 * and a floating layer for four fixed options.
 */
export function CreateSandboxDialog({
  open,
  onOpenChange,
  sizes,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sizes: MachineSize[];
  busy: boolean;
  onCreate: (input: {
    type: SandboxType;
    ttlSeconds: number | null;
    name?: string;
  }) => Promise<void>;
}) {
  const first = sizes[0]?.name;
  const [type, setType] = useState<SandboxType | undefined>(first);
  const [ttl, setTtl] = useState<string>("3600");
  const [name, setName] = useState("");

  useEffect(() => {
    if (type && sizes.some((size) => size.name === type)) return;

    setType(first);
  }, [type, first, sizes]);

  function reset() {
    setType(first);
    setTtl("3600");
    setName("");
  }

  function submit() {
    if (busy || !type) return;

    const input: { type: SandboxType; ttlSeconds: number | null; name?: string } = {
      type,
      ttlSeconds: ttl === "none" ? null : Number(ttl),
    };

    if (name.trim()) input.name = name.trim();

    void onCreate(input).then(() => {
      reset();
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next && !busy) reset();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create sandbox</DialogTitle>
        </DialogHeader>

        <form
          id="create-sandbox"
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <legend className="text-base font-medium tracking-wide text-muted-foreground">
                Machine
              </legend>
            </div>

            <div role="radiogroup" aria-label="Machine size" className="grid grid-cols-2 gap-2">
              {sizes.map((size) => {
                const active = type === size.name;

                return (
                  <button
                    key={size.name}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setType(size.name)}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card/60 hover:border-border hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn("font-medium", active ? "text-primary" : "text-foreground")}
                      >
                        {size.name}
                      </span>
                      {active ? (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {size.vcpu} vCPU · {size.memMib / 1024} GiB
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-base font-medium tracking-wide text-muted-foreground">
              Auto-stop
            </legend>
            <Segmented
              label="Auto-stop"
              options={TTL_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
              value={ttl as (typeof TTL_CHOICES)[number]["value"]}
              onChange={(next) => setTtl(next)}
            />
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sandbox-name" className="text-base font-medium text-muted-foreground">
              Name <span className="font-normal text-muted-foreground/60">optional</span>
            </Label>
            <Input
              id="sandbox-name"
              className="text-base"
              value={name}
              placeholder="agent-run-42"
              spellCheck={false}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="create-sandbox" size="sm" disabled={busy || !type}>
            {busy ? "Creating…" : "Create Sandbox"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
