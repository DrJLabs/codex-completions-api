import { describe, expect, it } from "vitest";
import { loadTranscript, REQUIRED_TRANSCRIPTS } from "../shared/transcript-utils.js";

const BACKENDS = [
  { key: "proto", expectedBackend: "proto", expectedStorage: "proto" },
  { key: "app", expectedBackend: "app-server", expectedStorage: "app" },
];

async function readTranscriptOrThrow(filename, backend) {
  try {
    return await loadTranscript(filename, { backend });
  } catch (err) {
    throw new Error(`Missing transcript for ${backend}/${filename}: ${err.message}`);
  }
}

function stripMetadata(payload) {
  const clone = structuredClone(payload);
  delete clone.metadata;
  return clone;
}

describe("chat fixture parity", () => {
  for (const filename of REQUIRED_TRANSCRIPTS) {
    it(`matches proto vs app outputs for ${filename}`, async () => {
      const [proto, app] = await Promise.all(
        BACKENDS.map((backend) => readTranscriptOrThrow(filename, backend.key))
      );

      const scenarioName = filename.replace(/\.json$/, "");

      expect(proto.metadata?.scenario).toBe(scenarioName);
      expect(app.metadata?.scenario).toBe(scenarioName);

      expect(proto.metadata?.backend).toBe(BACKENDS[0].expectedBackend);
      expect(app.metadata?.backend).toBe(BACKENDS[1].expectedBackend);
      expect(proto.metadata?.backend_storage).toBe(BACKENDS[0].expectedStorage);
      expect(app.metadata?.backend_storage).toBe(BACKENDS[1].expectedStorage);

      const protoBody = stripMetadata(proto);
      const appBody = stripMetadata(app);

      expect(appBody).toEqual(protoBody);
    });
  }
});
