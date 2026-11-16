import { describe, expect, it } from "bun:test";
import { lint } from "../testing/lint.mjs";

const rule = "no-base-ui-outside-ui";

describe(`aven/${rule}`, () => {
  it("refuses a Base UI import outside the vendored layer", () => {
    expect(
      lint(
        rule,
        'import { Slider } from "@base-ui/react/slider";\n',
        "apps/web/src/modules/threads/components/effort.tsx",
      ),
    ).toHaveLength(1);
  });

  it("allows a Base UI import inside the vendored layer", () => {
    expect(
      lint(
        rule,
        'import { Slider } from "@base-ui/react/slider";\n',
        "apps/web/src/components/ui/slider.tsx",
      ),
    ).toHaveLength(0);
  });
});
