import { describe, expect, test } from "vitest";
import {
  createToolBufferTracker,
  trackToolBufferOpen,
  clampEmittableIndex,
  detectNestedToolBuffer,
  abortToolBuffer,
  completeToolBuffer,
  shouldSkipBlock,
} from "../../src/handlers/chat/tool-buffer.js";

describe("tool buffer tracker", () => {
  test("gates emitted content until </use_tool> appears", () => {
    const tracker = createToolBufferTracker();
    const firstChunk = "<use_tool>\n  <name>lookup_user</name>\n  <args>{";
    expect(trackToolBufferOpen(tracker, firstChunk, 0)).toBe(0);
    const gated = clampEmittableIndex(tracker, 0, firstChunk.length, -1, false);
    expect(gated).toBe(0);

    const completed = `${firstChunk}"id":"42"}</args>\n</use_tool>`;
    completeToolBuffer(tracker, completed.length);
    const ungated = clampEmittableIndex(tracker, 0, completed.length, -1, false);
    expect(ungated).toBe(completed.length);
  });

  test("flags nested <use_tool> markers before a close tag", () => {
    const tracker = createToolBufferTracker();
    const payload = "<use_tool><name>a</name>";
    expect(trackToolBufferOpen(tracker, payload, 0)).toBe(0);
    const nestedText = `${payload}<use_tool><name>nested</name>`;
    expect(detectNestedToolBuffer(tracker, nestedText)).toBeGreaterThan(0);
    const { literal } = abortToolBuffer(tracker, nestedText);
    expect(literal).toBe("<use_tool><name>a</name><use_tool><name>nested</name>");
  });

  test("provides literal payload when aborted mid-stream", () => {
    const tracker = createToolBufferTracker();
    const partial = "<use_tool><name>a</name>";
    expect(trackToolBufferOpen(tracker, partial, 0)).toBe(0);
    const { literal, start } = abortToolBuffer(tracker, partial);
    expect(start).toBe(0);
    expect(literal).toBe(partial);
  });

  test("skips previously aborted segments when parsing future blocks", () => {
    const tracker = createToolBufferTracker();
    const chunk = "<use_tool><name>a</name>";
    expect(trackToolBufferOpen(tracker, chunk, 0)).toBe(0);
    abortToolBuffer(tracker, chunk);
    expect(shouldSkipBlock(tracker, chunk.length)).toBe(true);
    completeToolBuffer(tracker, chunk.length);
    expect(shouldSkipBlock(tracker, chunk.length + 5)).toBe(false);
  });
});
