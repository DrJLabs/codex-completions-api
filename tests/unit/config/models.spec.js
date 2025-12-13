import { describe, it, expect } from "vitest";

import { publicModelIds } from "../../../src/config/models.js";

describe("model id advertising", () => {
  it("includes gpt-5.2-codev-L in dev only", () => {
    expect(publicModelIds(true)).toContain("gpt-5.2-codev-L");
    expect(publicModelIds(false)).not.toContain("gpt-5.2-codev-L");
  });
});
