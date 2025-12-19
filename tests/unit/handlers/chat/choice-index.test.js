import { describe, expect, test } from "vitest";
import { resolveChoiceIndexFromPayload } from "../../../../src/handlers/chat/choice-index.js";

describe("choice index resolution", () => {
  test("prefers choice_index when present", () => {
    expect(resolveChoiceIndexFromPayload({ choice_index: 2 })).toBe(2);
  });

  test("falls back to choiceIndex when present", () => {
    expect(resolveChoiceIndexFromPayload({ choiceIndex: "3" })).toBe(3);
  });

  test("walks nested payloads and choices arrays", () => {
    const nested = {
      message: {
        payload: {
          choices: [{ delta: { choice_index: 4 } }],
        },
      },
    };
    expect(resolveChoiceIndexFromPayload(nested)).toBe(4);
  });

  test("handles cyclic payloads without throwing", () => {
    const payload = {};
    payload.payload = payload;
    expect(resolveChoiceIndexFromPayload(payload)).toBe(0);
  });
});
