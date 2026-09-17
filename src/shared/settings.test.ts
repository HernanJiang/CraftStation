import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOP_SHORTCUT_ORDER,
  defaultSharedSettings,
  normalizeSharedSettings,
  normalizeSidebarShortcutOrder,
  normalizeTopShortcutOrder,
} from "./settings";

describe("shared settings defaults", () => {
  it("persists one global default permission mode for every model", () => {
    expect(defaultSharedSettings.defaultPermissionMode).toBe("ask");
    expect(normalizeSharedSettings({}).defaultPermissionMode).toBe("ask");
    expect(
      normalizeSharedSettings({ defaultPermissionMode: "full-access" }).defaultPermissionMode,
    ).toBe("full-access");
    expect(
      normalizeSharedSettings({ defaultPermissionMode: "unsupported" }).defaultPermissionMode,
    ).toBe("ask");
  });

  it("leaves the custom global prompt blank by default", () => {
    expect(defaultSharedSettings.customGlobalPrompt).toBe("");
    expect(normalizeSharedSettings({}).customGlobalPrompt).toBe("");
    expect(normalizeSharedSettings({ customGlobalPrompt: "be concise" }).customGlobalPrompt).toBe(
      "be concise",
    );
  });

  it("normalizes sidebar shortcut order without duplicates or omissions", () => {
    expect(normalizeSidebarShortcutOrder(["schedules", "schedules"])).toEqual([
      "schedules",
      "pullRequests",
      "githubActions",
    ]);
  });

  it("defaults fresh installs to the crafting, MCP and settings pins", () => {
    expect(normalizeTopShortcutOrder(undefined)).toEqual([...DEFAULT_TOP_SHORTCUT_ORDER]);
    expect(DEFAULT_TOP_SHORTCUT_ORDER).toEqual(["crafting", "settings.mcpServers", "settingsHome"]);
    expect(normalizeSharedSettings({}).topShortcutOrder).toBeUndefined();
  });

  it("dedupes top pins without resurrecting removed defaults", () => {
    expect(
      normalizeTopShortcutOrder(["settings.mcpServers", "settings.mcpServers", "crafting"]),
    ).toEqual(["settings.mcpServers", "crafting"]);
    expect(normalizeTopShortcutOrder([])).toEqual([]);
    expect(normalizeTopShortcutOrder(["settings.unknownFuture", "crafting"])).toEqual([
      "settings.unknownFuture",
      "crafting",
    ]);
  });

  it("enables notifications and displays them for visible threads by default", () => {
    expect(defaultSharedSettings.notificationsEnabled).toBe(true);
    expect(defaultSharedSettings.remotePushEnabled).toBe(true);
    expect(defaultSharedSettings.notificationFilter).toBe("all");
  });

  it("defaults preventSleep to while-remote-access", () => {
    expect(defaultSharedSettings.preventSleep).toBe("while-remote-access");
    expect(normalizeSharedSettings({}).preventSleep).toBe("while-remote-access");
  });

  it("defaults the whole-app zoom to 100% and repairs foreign values", () => {
    expect(defaultSharedSettings.zoomFactor).toBe(1);
    expect(normalizeSharedSettings({}).zoomFactor).toBe(1);
    expect(normalizeSharedSettings({ zoomFactor: 1.5 }).zoomFactor).toBe(1.5);
    expect(normalizeSharedSettings({ zoomFactor: 99 }).zoomFactor).toBe(1);
  });

  it("starts with no explicit default models and keeps explicit picks", () => {
    expect(defaultSharedSettings.defaultModels).toEqual({});
    expect(normalizeSharedSettings({}).defaultModels).toEqual({});
    expect(
      normalizeSharedSettings({ defaultModels: { codex: "gpt-5.6-sol" } }).defaultModels,
    ).toEqual({ codex: "gpt-5.6-sol" });
  });

  it("preserves global provider and model effort/Fast preferences", () => {
    expect(
      normalizeSharedSettings({
        providerModelPreferences: {
          codex: {
            "gpt-5.6-luna": { effort: "max", fast: true },
            "gpt-5.6-sol": { effort: "high", fast: false },
          },
        },
      }).providerModelPreferences,
    ).toEqual({
      codex: {
        "gpt-5.6-luna": { effort: "max", fast: true },
        "gpt-5.6-sol": { effort: "high", fast: false },
      },
    });
  });

  it("adds an empty model preference map to the previous shared-settings shape", () => {
    expect(
      normalizeSharedSettings({
        providerConfigs: { codex: { model: "gpt-5.6-sol", effort: "high", fast: false } },
      }).providerModelPreferences,
    ).toEqual({});
  });

  it("adds automatic Windows shell settings to a previous settings shape", () => {
    const normalized = normalizeSharedSettings({ terminalPosition: "right" });
    expect(normalized).toMatchObject({
      terminalPosition: "right",
      windowsShellPath: "auto",
      windowsInternalShellPath: "auto",
      windowsShellArguments: "",
    });
  });

  it("migrates legacy sleep booleans into preventSleep", () => {
    expect(
      normalizeSharedSettings({
        preventSleepWhileWorking: true,
        remoteAccessPreventSleep: false,
      }).preventSleep,
    ).toBe("while-working");
    expect(
      normalizeSharedSettings({
        preventSleepWhileWorking: false,
        remoteAccessPreventSleep: true,
      }).preventSleep,
    ).toBe("while-remote-access");
    expect(normalizeSharedSettings({ remoteAccessPreventSleep: true }).preventSleep).toBe(
      "while-remote-access",
    );
    expect(
      normalizeSharedSettings({
        preventSleepWhileWorking: false,
        remoteAccessPreventSleep: false,
      }).preventSleep,
    ).toBe("while-working");
  });

  it("lets an explicit preventSleep value win over legacy booleans", () => {
    const migrated = normalizeSharedSettings({
      preventSleep: "always",
      preventSleepWhileWorking: true,
      remoteAccessPreventSleep: true,
    });
    expect(migrated.preventSleep).toBe("always");
    expect(migrated).not.toHaveProperty("preventSleepWhileWorking");
    expect(migrated).not.toHaveProperty("remoteAccessPreventSleep");
  });

  it("falls back via migration when preventSleep is invalid", () => {
    expect(
      normalizeSharedSettings({
        preventSleep: "never",
        preventSleepWhileWorking: true,
        remoteAccessPreventSleep: false,
      }).preventSleep,
    ).toBe("while-working");
    expect(
      normalizeSharedSettings({
        preventSleep: "never",
        remoteAccessPreventSleep: true,
      }).preventSleep,
    ).toBe("while-remote-access");
  });

  it("drops legacy sleep keys from the normalized output", () => {
    const migrated = normalizeSharedSettings({
      preventSleepWhileWorking: true,
      remoteAccessPreventSleep: true,
    });
    expect(migrated.preventSleep).toBe("while-remote-access");
    expect(migrated).not.toHaveProperty("preventSleepWhileWorking");
    expect(migrated).not.toHaveProperty("remoteAccessPreventSleep");
  });

  it("enables Own Subagents and Crossagents as standing MCP defaults and preserves opt-outs", () => {
    expect(defaultSharedSettings.enabledMcpServers.own_subagents).toBe(true);
    expect(defaultSharedSettings.enabledMcpServers.crossagents).toBe(true);
    expect(normalizeSharedSettings({}).enabledMcpServers).toMatchObject({
      own_subagents: true,
      crossagents: true,
    });
    expect(
      normalizeSharedSettings({ enabledMcpServers: { crossagents: false } }).enabledMcpServers,
    ).toMatchObject({ own_subagents: false, crossagents: false });
  });

  it("migrates legacy crossagent keys to ownSubagent keys without losing data", () => {
    const migrated = normalizeSharedSettings({
      crossagentSelectionUsage: [
        { agentKind: "kimi", modelId: "k3", fast: false, count: 2, lastUsedAt: 1 },
      ],
      crossagentRoutingOverrides: [{ tags: ["review"], agentKind: "kimi", updatedAt: 2 }],
      crossagentPausedProviders: ["grok"],
      crossagentHiddenModels: { kimi: ["k3"] },
      crossagentRoutingGuide: "prefer kimi",
    });
    expect(migrated.ownSubagentSelectionUsage).toEqual([
      { agentKind: "kimi", modelId: "k3", fast: false, count: 2, lastUsedAt: 1 },
    ]);
    expect(migrated.ownSubagentRoutingOverrides).toEqual([
      { tags: ["review"], agentKind: "kimi", updatedAt: 2 },
    ]);
    expect(migrated.ownSubagentPausedProviders).toEqual(["grok"]);
    expect(migrated.ownSubagentHiddenModels).toEqual({ kimi: ["k3"] });
    expect(migrated.ownSubagentRoutingGuide).toBe("prefer kimi");
    expect(migrated).not.toHaveProperty("crossagentSelectionUsage");
    expect(migrated).not.toHaveProperty("crossagentRoutingOverrides");
    expect(migrated).not.toHaveProperty("crossagentPausedProviders");
    expect(migrated).not.toHaveProperty("crossagentHiddenModels");
    expect(migrated).not.toHaveProperty("crossagentRoutingGuide");
  });

  it("prefers new ownSubagent keys over legacy ones and pins the native lane", () => {
    const migrated = normalizeSharedSettings({
      ownSubagentSelectionUsage: [
        { agentKind: "codex", modelId: "gpt", fast: false, count: 1, lastUsedAt: 1 },
      ],
      crossagentSelectionUsage: [
        { agentKind: "kimi", modelId: "k3", fast: false, count: 9, lastUsedAt: 1 },
      ],
      ownSubagentsRouteOrder: ["kimi"],
    });
    expect(migrated.ownSubagentSelectionUsage).toEqual([
      { agentKind: "codex", modelId: "gpt", fast: false, count: 1, lastUsedAt: 1 },
    ]);
    expect(migrated.ownSubagentsRouteOrder).toEqual(["kimi", "native"]);
    expect(normalizeSharedSettings({}).ownSubagentsRouteOrder).toEqual(["native"]);
  });

  it("defaults to squash merging and preserves a valid selected merge method", () => {
    expect(defaultSharedSettings.prMergeMethod).toBe("squash");
    expect(normalizeSharedSettings({ prMergeMethod: "merge" }).prMergeMethod).toBe("merge");
    expect(normalizeSharedSettings({ prMergeMethod: "invalid" }).prMergeMethod).toBe("squash");
  });

  it("migrates legacy pull request automation defaults", () => {
    expect(normalizeSharedSettings({ prWatchDefault: true }).prAutomationDefault).toBe("fix");
    expect(
      normalizeSharedSettings({ prWatchDefault: true, prAutoMergeDefault: true })
        .prAutomationDefault,
    ).toBe("merge");
    expect(
      normalizeSharedSettings({
        prAutomationDefault: "off",
        prWatchDefault: true,
        prAutoMergeDefault: true,
      }).prAutomationDefault,
    ).toBe("off");
  });

  it("migrates the retired Qwen 3.8 preview model without changing other providers", () => {
    const migrated = normalizeSharedSettings({
      providerConfigs: {
        qwen: { model: "qwen3.8-max-preview", mode: "agent", approvalPolicy: "auto" },
        "claude:qwen": { model: "qwen3.8-max-preview" },
      },
      providerModelPreferences: {
        qwen: { "qwen3.8-max-preview": { effort: "xhigh", fast: false } },
        "claude:qwen": { "qwen3.8-max-preview": { effort: "high", fast: true } },
      },
      commitGenProvider: "qwen",
      commitGenModel: "qwen3.8-max-preview",
      favoriteModels: [
        { agentKind: "qwen", modelId: "qwen3.8-max-preview", presentationMode: "gui" },
      ],
      recentModels: [
        { agentKind: "qwen", modelId: "qwen3.8-max-preview", presentationMode: "gui" },
        { agentKind: "claude:qwen", modelId: "qwen3.8-max-preview", presentationMode: "gui" },
      ],
      agentSelectionUsage: [
        {
          agentKind: "qwen",
          modelId: "qwen3.8-max-preview",
          fast: false,
          count: 2,
          lastUsedAt: 1,
        },
      ],
      ownSubagentSelectionUsage: [
        {
          agentKind: "qwen",
          modelId: "qwen3.8-max-preview",
          fast: false,
          count: 1,
          lastUsedAt: 1,
        },
      ],
      ownSubagentRoutingOverrides: [
        {
          tags: ["review"],
          agentKind: "qwen",
          modelId: "qwen3.8-max-preview",
          updatedAt: 1,
        },
      ],
      hiddenModels: { qwen: ["qwen3.8-max-preview", "qwen3.8-max"] },
    });

    expect(migrated.providerConfigs.qwen?.model).toBe("qwen3.8-max");
    expect(migrated.providerConfigs["claude:qwen"]?.model).toBe("qwen3.8-max-preview");
    expect(migrated.providerModelPreferences).toMatchObject({
      qwen: { "qwen3.8-max": { effort: "xhigh", fast: false } },
      "claude:qwen": { "qwen3.8-max-preview": { effort: "high", fast: true } },
    });
    expect(migrated.commitGenModel).toBe("qwen3.8-max");
    expect(migrated.favoriteModels).toEqual([
      { agentKind: "qwen", modelId: "qwen3.8-max", presentationMode: "gui" },
    ]);
    expect(migrated.recentModels).toEqual([
      { agentKind: "claude:qwen", modelId: "qwen3.8-max-preview", presentationMode: "gui" },
    ]);
    expect(migrated.agentSelectionUsage).toEqual([]);
    expect(migrated.ownSubagentSelectionUsage).toEqual([]);
    expect(migrated.ownSubagentRoutingOverrides[0]?.modelId).toBe("qwen3.8-max");
    expect(migrated.hiddenModels.qwen).toEqual(["qwen3.8-max"]);
  });
});
