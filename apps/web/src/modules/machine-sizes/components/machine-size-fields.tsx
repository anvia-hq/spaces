import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MachineSizeFields = {
  name: string;
  vcpu: string;
  memMib: string;
  diskGb: string;
  description: string;
};

export type ParsedMachineSize = {
  vcpu: number;
  memMib: number;
  diskGb: number;
  description: string | null;
};

export const EMPTY_FIELDS: MachineSizeFields = {
  name: "",
  vcpu: "2",
  memMib: "4096",
  diskGb: "51",
  description: "",
};

const RANGE = {
  vcpu: { min: 1, max: 64 },
  memMib: { min: 512, max: 262_144 },
  diskGb: { min: 5, max: 2048 },
} as const;

function whole(value: string, range: { min: number; max: number }): number | null {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) return null;

  return parsed;
}

/** The numbers the API accepts, or null when a field is out of range. */
export function parseMachineSizeFields(fields: MachineSizeFields): ParsedMachineSize | null {
  const vcpu = whole(fields.vcpu, RANGE.vcpu);
  const memMib = whole(fields.memMib, RANGE.memMib);
  const diskGb = whole(fields.diskGb, RANGE.diskGb);
  const description = fields.description.trim();

  if (vcpu === null || memMib === null || diskGb === null) return null;

  if (description.length > 200) return null;

  return { vcpu, memMib, diskGb, description: description === "" ? null : description };
}

export function MachineSizeInputs({
  fields,
  onChange,
  showName,
}: {
  fields: MachineSizeFields;
  onChange: (fields: MachineSizeFields) => void;
  showName: boolean;
}) {
  const set = (patch: Partial<MachineSizeFields>) => onChange({ ...fields, ...patch });

  return (
    <>
      {showName && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="size-name" className="text-base font-medium text-muted-foreground">
            Name
          </Label>
          <Input
            id="size-name"
            className="text-base"
            value={fields.name}
            placeholder="build-heavy"
            spellCheck={false}
            maxLength={32}
            autoFocus
            onChange={(event) => set({ name: event.target.value })}
          />
          <p className="text-base text-muted-foreground">
            Lowercase letters, digits and dashes, starting with a letter.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="size-vcpu" className="text-base font-medium text-muted-foreground">
            vCPU
          </Label>
          <Input
            id="size-vcpu"
            className="text-base"
            inputMode="numeric"
            value={fields.vcpu}
            onChange={(event) => set({ vcpu: event.target.value })}
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
            value={fields.memMib}
            onChange={(event) => set({ memMib: event.target.value })}
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
            value={fields.diskGb}
            onChange={(event) => set({ diskGb: event.target.value })}
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
          value={fields.description}
          maxLength={200}
          onChange={(event) => set({ description: event.target.value })}
        />
      </div>
    </>
  );
}
