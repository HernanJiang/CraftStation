import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  harnessConfigurationTarget,
  openHarnessConfiguration,
} from "./openHarnessConfiguration";

const initialPanelState = usePanelStore.getState();

function resetPanelStore() {
  usePanelStore.setState({
    ...initialPanelState,
    settingsOpen: false,
    settingsSection: null,
    modelUsageDialogOpen: false,
    modelUsageWorkspaceTab: "crafting",
  });
}

describe("harnessConfigurationTarget", () => {
  it("routes native CLI harnesses to their agent settings page", () => {
    expect(harnessConfigurationTarget("kimi")).toEqual({
      kind: "agent-settings",
      section: "agents:kimi",
    });
    expect(harnessConfigurationTarget("codex").kind).toBe("agent-settings");
    expect(harnessConfigurationTarget("grok").kind).toBe("agent-settings");
    expect(harnessConfigurationTarget("antigravity").kind).toBe("agent-settings");
    expect(harnessConfigurationTarget("opencode").kind).toBe("agent-settings");
  });

  it("routes DeepSeek API Runtime to the usage workspace account pool", () => {
    expect(harnessConfigurationTarget("deepseek-api")).toEqual({ kind: "usage-workspace" });
  });

  it("routes unofficial or uninstalled CLIs to the ACP registry", () => {
    expect(harnessConfigurationTarget("deepseek")).toEqual({ kind: "acp-registry" });
  });
});

describe("openHarnessConfiguration", () => {
  beforeEach(resetPanelStore);
  afterEach(resetPanelStore);

  it("opens Kimi agent settings so a not-configured row can be signed in", () => {
    openHarnessConfiguration("kimi");
    expect(usePanelStore.getState().settingsOpen).toBe(true);
    expect(usePanelStore.getState().settingsSection).toBe("agents:kimi");
  });

  it("opens the usage workspace for DeepSeek API Runtime", () => {
    openHarnessConfiguration("deepseek-api");
    expect(usePanelStore.getState().modelUsageDialogOpen).toBe(true);
    expect(usePanelStore.getState().modelUsageWorkspaceTab).toBe("usage");
  });

  it("opens the ACP registry for an uninstalled official DeepSeek CLI", () => {
    openHarnessConfiguration("deepseek");
    expect(usePanelStore.getState().settingsOpen).toBe(true);
    expect(usePanelStore.getState().settingsSection).toBe("acpRegistry");
  });
});
