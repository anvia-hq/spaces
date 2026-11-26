import { useEffect, useState } from "react";
import {
  classifyNetworkEntry,
  isPrivateIpOrCidr,
  type MachineSize,
  type NetworkMode,
  type NetworkPolicy,
  type SandboxType,
} from "@spaces/shared/sandbox";
import { Check } from "lucide-react";
import { Segmented } from "@/components/console/segmented";
import { Button } from "@/components/ui/button";
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset";
import { Form } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { Runtime } from "@/lib/api.ts";
import { cn } from "@/lib/utils";

const AUTO_RUNTIME = "__auto__";

const TTL_CHOICES = [
  { value: "900", label: "15 min" },
  { value: "3600", label: "1 hour" },
  { value: "28800", label: "8 hours" },
  { value: "none", label: "Never" },
] as const;

const NETWORK_CHOICES: { value: NetworkMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "open", label: "Public" },
  { value: "deny", label: "None" },
  { value: "allow", label: "Allowlist" },
];

function allowlistError(entries: string[]): string | null {
  if (entries.length > 100) return "At most 100 entries are allowed.";

  for (const entry of entries) {
    const kind = classifyNetworkEntry(entry);

    if (!kind) {
      return `Invalid entry "${entry}" — use a domain, *.domain, or public IP/CIDR.`;
    }

    if (kind === "ip" && isPrivateIpOrCidr(entry)) {
      return `Private or reserved address "${entry}" is not allowed.`;
    }
  }

  return null;
}

export function CreateSandboxDialog({
  open,
  onOpenChange,
  sizes,
  runtimes,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sizes: MachineSize[];
  runtimes: Runtime[];
  busy: boolean;
  onCreate: (input: {
    type: SandboxType;
    ttlSeconds: number | null;
    name?: string;
    runtime?: string;
    network?: NetworkPolicy;
  }) => Promise<boolean>;
}) {
  const first = sizes[0]?.name;
  const [type, setType] = useState<SandboxType | undefined>(first);
  const [ttl, setTtl] = useState<string>("3600");
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState(AUTO_RUNTIME);
  const [networkMode, setNetworkMode] = useState<NetworkMode>("default");
  const [allowText, setAllowText] = useState("");

  useEffect(() => {
    if (type && sizes.some((size) => size.name === type)) return;

    setType(first);
  }, [type, first, sizes]);

  function reset() {
    setType(first);
    setTtl("3600");
    setName("");
    setRuntime(AUTO_RUNTIME);
    setNetworkMode("default");
    setAllowText("");
  }

  function close() {
    if (!busy) reset();

    onOpenChange(false);
  }

  const allowEntries = allowText.split(/[\s,]+/).flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
  const allowError = networkMode === "allow" ? allowlistError(allowEntries) : null;
  const allowInvalid =
    networkMode === "allow" && (allowEntries.length === 0 || allowError !== null);

  function submit() {
    if (busy || !type || allowInvalid) return;

    const input: {
      type: SandboxType;
      ttlSeconds: number | null;
      name?: string;
      runtime?: string;
      network?: NetworkPolicy;
    } = {
      type,
      ttlSeconds: ttl === "none" ? null : Number(ttl),
    };

    if (name.trim()) input.name = name.trim();

    if (runtime !== AUTO_RUNTIME) input.runtime = runtime;

    if (networkMode !== "default") {
      input.network =
        networkMode === "allow"
          ? { mode: "allow", allow: allowEntries }
          : { mode: networkMode, allow: [] };
    }

    void onCreate(input).then((ok) => {
      if (!ok) return;

      reset();
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create sandbox</DialogTitle>
        </DialogHeader>

        <Form
          id="create-sandbox"
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Fieldset className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <FieldsetLegend className="text-base font-medium tracking-wide text-muted-foreground">
                Machine
              </FieldsetLegend>
            </div>

            <div role="radiogroup" aria-label="Machine size" className="grid grid-cols-2 gap-2">
              {sizes.map((size) => {
                const active = type === size.name;

                return (
                  <Button
                    key={size.name}
                    type="button"
                    variant="ghost"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setType(size.name)}
                    className={cn(
                      "h-auto flex-col items-stretch justify-start gap-1 rounded-lg border px-3 py-2.5 text-left font-normal whitespace-normal",
                      active
                        ? "border-primary bg-primary/10 hover:bg-primary/10"
                        : "border-border bg-card/60 hover:border-border hover:bg-card/60 hover:text-foreground",
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
                  </Button>
                );
              })}
            </div>
          </Fieldset>

          <Fieldset className="flex flex-col gap-2">
            <FieldsetLegend className="text-base font-medium tracking-wide text-muted-foreground">
              Auto-stop
            </FieldsetLegend>
            <Segmented
              label="Auto-stop"
              options={TTL_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
              value={ttl as (typeof TTL_CHOICES)[number]["value"]}
              onChange={(next) => setTtl(next)}
            />
          </Fieldset>

          <Fieldset className="flex flex-col gap-2">
            <FieldsetLegend className="text-base font-medium tracking-wide text-muted-foreground">
              Network
            </FieldsetLegend>
            <Segmented
              label="Network"
              options={NETWORK_CHOICES}
              value={networkMode}
              onChange={(next) => setNetworkMode(next)}
            />
            {networkMode === "allow" && (
              <div className="flex flex-col gap-1.5">
                <Input
                  className="text-base"
                  value={allowText}
                  placeholder="github.com, *.npmjs.org"
                  aria-label="Allowed domains or public IPs"
                  aria-invalid={allowError !== null}
                  spellCheck={false}
                  onChange={(event) => setAllowText(event.target.value)}
                />
                {allowError && (
                  <p role="alert" className="text-sm text-destructive">
                    {allowError}
                  </p>
                )}
              </div>
            )}
          </Fieldset>

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

          {runtimes.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-medium text-muted-foreground">Runtime</span>
              <Select value={runtime} onValueChange={(value) => setRuntime(String(value))}>
                <SelectTrigger className="h-8 w-full text-base">
                  <span className="truncate">
                    {runtime === AUTO_RUNTIME ? "Auto (least loaded)" : runtime}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_RUNTIME}>Auto (least loaded)</SelectItem>
                  {runtimes.map((choice) => (
                    <SelectItem key={choice.id} value={choice.name}>
                      {choice.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </Form>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-sandbox"
            size="sm"
            disabled={busy || !type || allowInvalid}
          >
            {busy ? "Creating…" : "Create Sandbox"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
