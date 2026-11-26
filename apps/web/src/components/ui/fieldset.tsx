import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";

function Fieldset({ className, ...props }: FieldsetPrimitive.Root.Props) {
  return <FieldsetPrimitive.Root data-slot="fieldset" className={className} {...props} />;
}

function FieldsetLegend({ className, ...props }: FieldsetPrimitive.Legend.Props) {
  return <FieldsetPrimitive.Legend data-slot="fieldset-legend" className={className} {...props} />;
}

export { Fieldset, FieldsetLegend };
