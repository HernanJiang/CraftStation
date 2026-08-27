import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hostCodexHome,
  isCodexRouterOverlayHome,
  isolatedCodexAuthPath,
  isolatedCodexHomeCandidates,
  nativePrivateCodexHome,
} from "./codexRouterOverlay";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("isCodexRouterOverlayHome", () => {
  it("detects a Codex-Router catalog overlay", () => {
    const home = mkdtempSync(join(tmpdir(), "craftstation-codex-overlay-"));
    roots.push(home);
    writeFileSync(
      join(home, "config.toml"),
      'model_provider = "Codex-Router"\nmodel_catalog_json = "C:\\\\Users\\\\Haona\\\\AppData\\\\Local\\\\Codex-Router\\\\UserData\\\\model-catalog.json"\n',
    );
    expect(isCodexRouterOverlayHome(home)).toBe(true);
  });

  it("detects a loopback Router gateway overlay", () => {
    const home = mkdtempSync(join(tmpdir(), "craftstation-codex-overlay-gw-"));
    roots.push(home);
    writeFileSync(
      join(home, "config.toml"),
      '[model_providers.custom]\nbase_url = "http://127.0.0.1:28085/v1"\n',
    );
    expect(isCodexRouterOverlayHome(home)).toBe(true);
  });

  it("leaves an official Codex home alone", () => {
    const home = mkdtempSync(join(tmpdir(), "craftstation-codex-official-"));
    roots.push(home);
    writeFileSync(join(home, "config.toml"), 'model_provider = "openai"\n');
    expect(isCodexRouterOverlayHome(home)).toBe(false);
  });
});

describe("isolatedCodexHomeCandidates", () => {
  it("always includes the CraftStation-owned Codex home", () => {
    const homes = isolatedCodexHomeCandidates();
    expect(homes).toContain(nativePrivateCodexHome());
    if (isCodexRouterOverlayHome(hostCodexHome())) {
      expect(homes).not.toContain(join(homedir(), ".codex"));
    }
  });
});

describe("isolatedCodexAuthPath", () => {
  it("does not return the host auth.json when that home is a Router overlay", () => {
    if (!isCodexRouterOverlayHome(hostCodexHome())) {
      return;
    }
    expect(isolatedCodexAuthPath()).toBe(join(nativePrivateCodexHome(), "auth.json"));
  });
});
