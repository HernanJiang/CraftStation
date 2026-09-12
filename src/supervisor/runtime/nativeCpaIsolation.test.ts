import { describe, expect, it } from "vitest";
import {
  exportAntigravityCompatibility,
  exportCodexCompatibility,
  exportGrokCompatibility,
  exportKimiCompatibility,
  exportOpenCodeCompatibility,
  type TargetHarnessConfig,
} from "./compatibilityBridge/exporters";
import { managedGrokProcessEnvironment } from "./grokProfiles";
import { managedCodexProcessEnvironment, stripCodexRouterEnv } from "./codexProfiles";
import { managedKimiProcessEnvironment } from "./kimiProfiles";
import { prepareAntigravityProfile } from "./nativeProfile";

/**
 * Product rule: only a non-native model on the native vendor may go through
 * the Compatibility Bridge (CPA). Native runs use the official CLI against
 * the account pool — so no CPA endpoint env key may ever survive native env
 * isolation, even when the host environment points at a running bridge
 * (e.g. `GROK_API_BASE=http://127.0.0.1:8317/v1`).
 */
const RUNNING_BRIDGE = {
  running: true,
  endpoint: "http://127.0.0.1:8317",
  host: "127.0.0.1",
  port: 8317,
  apiKey: "bridge-key",
};

function exporterFor(harnessKind: string): TargetHarnessConfig {
  switch (harnessKind) {
    case "opencode":
      return exportOpenCodeCompatibility(RUNNING_BRIDGE, "model-x");
    case "codex":
      return exportCodexCompatibility(RUNNING_BRIDGE, "model-x");
    case "kimi":
      return exportKimiCompatibility(RUNNING_BRIDGE, "model-x");
    case "grok":
      return exportGrokCompatibility(RUNNING_BRIDGE, "model-x");
    case "antigravity":
      return exportAntigravityCompatibility(RUNNING_BRIDGE, "model-x");
    default:
      throw new Error(`unexpected harness ${harnessKind}`);
  }
}

function poisonedHostEnv(keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, `http://127.0.0.1:8317/v1-${key}`]));
}

describe("native CPA isolation", () => {
  it.each(["grok", "codex", "kimi", "antigravity"])(
    "native %s env blanks every CPA endpoint key",
    (harnessKind) => {
      const exported = exporterFor(harnessKind);
      const compatKeys = Object.keys(exported.customEnv);
      expect(compatKeys.length).toBeGreaterThan(0);
      const host = {
        PATH: "C:\\bin",
        ...poisonedHostEnv(compatKeys),
      };
      let native: Record<string, string>;
      if (harnessKind === "grok") {
        native = managedGrokProcessEnvironment("C:\\managed\\grok", host);
      } else if (harnessKind === "codex") {
        native = managedCodexProcessEnvironment("C:\\managed\\codex", host);
      } else if (harnessKind === "kimi") {
        native = managedKimiProcessEnvironment("C:\\managed\\kimi", host);
      } else {
        native = prepareAntigravityProfile({
          accountId: "account-1",
          credentialRoot: "C:\\managed\\antigravity",
        }).env;
        // Antigravity blanks without a base env: simulate the spawn-time
        // `{...process.env, ...native}` merge for the poisoned keys.
        native = { ...poisonedHostEnv(compatKeys), ...native };
      }
      for (const key of compatKeys) {
        // Either blanked or absent — never the poisoned bridge endpoint.
        expect(native[key] ?? "").not.toContain("127.0.0.1:8317");
      }
    },
  );

  it("codex probe env also omits CPA endpoint keys", () => {
    const exported = exporterFor("codex");
    const stripped = stripCodexRouterEnv({
      PATH: "C:\\bin",
      ...poisonedHostEnv(Object.keys(exported.customEnv)),
    });
    for (const key of Object.keys(exported.customEnv)) {
      expect(stripped[key]).toBeUndefined();
    }
  });

  it("documents the full CPA key surface under test", () => {
    // If an exporter gains a new customEnv key, the parametrized test above
    // automatically covers it — this pins the known surface for reviewers.
    expect(Object.keys(exporterFor("grok").customEnv).sort()).toEqual(
      ["GROK_API_BASE", "GROK_API_KEY"].sort(),
    );
    expect(Object.keys(exporterFor("codex").customEnv).sort()).toEqual(
      ["CODEX_BASE_URL", "CODEX_MODEL_PROVIDER", "OPENAI_API_KEY"].sort(),
    );
    expect(Object.keys(exporterFor("kimi").customEnv).sort()).toEqual(
      ["KIMI_API_KEY", "KIMI_BASE_URL", "KIMI_PROTOCOL"].sort(),
    );
    expect(Object.keys(exporterFor("antigravity").customEnv).sort()).toEqual(
      ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"].sort(),
    );
    expect(Object.keys(exporterFor("opencode").customEnv).sort()).toEqual(
      ["OPENCODE_API_BASE", "OPENCODE_API_KEY"].sort(),
    );
  });
});
