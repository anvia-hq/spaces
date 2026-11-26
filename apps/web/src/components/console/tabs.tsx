import type { ReactNode } from "react";
import { Tabs as ShadTabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  inline = false,
}: {
  tabs: readonly { value: T; label: string; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  inline?: boolean;
}) {
  return (
    <ShadTabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList
        variant={inline ? "default" : "line"}
        className={
          inline
            ? "h-8 gap-0.5 rounded-md bg-background/40 p-0.5"
            : "w-full justify-start gap-1 border-b px-0"
        }
      >
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className={inline ? "flex-none px-2 py-1 text-base" : "flex-none px-2.5"}
          >
            {t.label}
            {t.badge != null && (
              <span className="rounded bg-accent px-1 text-base text-muted-foreground">
                {t.badge}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
  );
}
