import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import { segmentsToContentBlocks } from "./sessionContentBlocks";

const locations: ProjectLocation[] = [{ kind: "posix", path: "/repo" }];

let tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function writeTempAudio(name = "standup.mp3"): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-audio-"));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, Buffer.from([0x49, 0x44, 0x33, 0x00]));
  return path;
}

describe("segmentsToContentBlocks audio", () => {
  it("sends readable audio attachments as audio blocks", async () => {
    const path = writeTempAudio();
    const blocks = await segmentsToContentBlocks(
      "transcribe",
      locations[0]!,
      [{ kind: "attachment", path, mimeType: "audio/mpeg" }],
      { audio: true },
    );

    expect(blocks).toContainEqual({ type: "audio", data: "SUQzAA==", mimeType: "audio/mpeg" });
    expect(blocks).toContainEqual({ type: "text", text: "transcribe" });
  });

  it("falls back to a resource link when the agent lacks audio support", async () => {
    const path = writeTempAudio();
    const blocks = await segmentsToContentBlocks(
      "transcribe",
      locations[0]!,
      [{ kind: "attachment", path, mimeType: "audio/mpeg" }],
      { audio: false },
    );

    expect(blocks).not.toContainEqual(expect.objectContaining({ type: "audio" }));
    expect(blocks).toContainEqual(
      expect.objectContaining({ type: "resource_link", mimeType: "audio/mpeg" }),
    );
  });

  it("falls back to a resource link when the audio file is missing", async () => {
    const blocks = await segmentsToContentBlocks(
      "transcribe",
      locations[0]!,
      [{ kind: "attachment", path: "/repo/missing-voice.ogg", mimeType: "audio/ogg" }],
      { audio: true },
    );

    expect(blocks).toContainEqual(
      expect.objectContaining({ type: "resource_link", mimeType: "audio/ogg" }),
    );
  });
});
