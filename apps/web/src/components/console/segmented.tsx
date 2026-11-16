import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;

        if (picked) onChange(picked);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="text-xs data-pressed:bg-accent data-pressed:text-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
