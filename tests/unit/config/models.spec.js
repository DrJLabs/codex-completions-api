import { describe, it, expect } from "vitest";

import { publicModelIds } from "../../../src/config/models.js";

describe("model id advertising", () => {
  it("includes gpt-5.2-codev-* aliases in dev only", () => {
    const dev = publicModelIds(true);
    const prod = publicModelIds(false);
    ["L", "M", "H", "XH"].forEach((suffix) => {
      expect(dev).toContain(`gpt-5.2-codev-${suffix}`);
      expect(prod).not.toContain(`gpt-5.2-codev-${suffix}`);
    });
  });
});
