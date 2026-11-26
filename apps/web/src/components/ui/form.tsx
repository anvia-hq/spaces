import { Form as FormPrimitive } from "@base-ui/react/form";

function Form({ className, noValidate = false, ...props }: FormPrimitive.Props) {
  return (
    <FormPrimitive data-slot="form" noValidate={noValidate} className={className} {...props} />
  );
}

export { Form };
