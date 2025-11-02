import { describe, expect, it } from "vitest";
import {
  loadTranscript,
  REQUIRED_TRANSCRIPTS,
  loadTranscriptManifest,
  TRANSCRIPT_MANIFEST_PATH,
} from "../shared/transcript-utils.js";

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

      expect(proto.metadata?.cli_version).toBeDefined();
      expect(app.metadata?.cli_version).toBe(proto.metadata?.cli_version);
      expect(proto.metadata?.commit).toBeDefined();
      expect(app.metadata?.commit).toBe(proto.metadata?.commit);
      expect(proto.metadata?.expected_status).toBeDefined();
      expect(app.metadata?.expected_status).toBe(proto.metadata?.expected_status);
      expect(proto.metadata?.node_version).toMatch(/^v\d+\./);
      expect(app.metadata?.node_version).toBe(proto.metadata?.node_version);

      const protoBody = stripMetadata(proto);
      const appBody = stripMetadata(app);

      expect(appBody).toEqual(protoBody);
    });
  }

  it("generates manifest entries for all required transcripts", async () => {
    const manifest = await loadTranscriptManifest();
    expect(manifest).toBeDefined();
    expect(manifest.scenarios).toBeDefined();
    expect(Object.keys(manifest.scenarios).length).toBeGreaterThanOrEqual(
      REQUIRED_TRANSCRIPTS.length
    );
    expect(manifest.cli_version).toBeDefined();

    const scenarioMap = new Map(Object.entries(manifest.scenarios));

    for (const filename of REQUIRED_TRANSCRIPTS) {
      const entry = scenarioMap.get(filename);
      expect(entry, `Missing manifest scenario for ${filename}`).toBeDefined();
      for (const backend of BACKENDS) {
        if (backend.key === "app") {
          const capture = entry?.captures?.app;
          expect(capture, `Missing capture for ${filename} (${backend.key})`).toBeDefined();
          expect(capture.cli_version).toBe(manifest.cli_version);
          expect(typeof capture.path).toBe("string");
          expect(capture.path.startsWith("app/")).toBe(true);
          expect(capture.captured_at).toBeDefined();
          expect(capture.backend).toBeDefined();
        } else {
          const capture = entry?.captures?.proto;
          expect(capture, `Missing capture for ${filename} (${backend.key})`).toBeDefined();
          expect(capture.cli_version).toBe(manifest.cli_version);
          expect(typeof capture.path).toBe("string");
          expect(capture.path.startsWith("proto/")).toBe(true);
          expect(capture.captured_at).toBeDefined();
          expect(capture.backend).toBeDefined();
        }
      }
    }

    expect(typeof TRANSCRIPT_MANIFEST_PATH).toBe("string");
  });
});
