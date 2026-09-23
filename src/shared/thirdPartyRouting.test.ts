import { describe, expect, it } from "vitest";
import {
  applyThirdPartyPickerSelection,
  catalogProviderKind,
  composerPickerAgentKind,
  foreignAcpModelId,
  isForeignCatalogModelForHarness,
  isThirdPartyAccountId,
  modelCatalogChannel,
  normalizeCommandCodeModelId,
  normalizeThirdPartyModelId,
  resolveAutoModelBinding,
  resolveThirdPartyAccountForLaunch,
  resolveThirdPartyHarnessForModel,
  sameComposerAccount,
} from "./thirdPartyRouting";

const accounts = [
  { accountId: "tp-1", provider: "openai-compatible", enabled: true },
  { accountId: "sub-1", provider: "kimi", enabled: true },
];

describe("thirdPartyRouting", () => {
  it("keeps remote model ids free of the internal OpenCode provider prefix", () => {
    expect(normalizeThirdPartyModelId("craftstation/glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(normalizeThirdPartyModelId("vendor/glm-5.3-flash")).toBe("vendor/glm-5.3-flash");
  });

  it("returns undefined for native subscription models (pool path unchanged)", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "kimi",
        model: "kimi-for-coding",
        customModels: [],
        accounts,
      }),
    ).toBeUndefined();
  });

  it("does not hijack official ChatGPT onto a Chiral row that shares the model id", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "gpt-5.6-sol",
        customModels: [{ provider: "codex", modelId: "gpt-5.6-sol", accountId: "tp-1" }],
        accounts,
      }),
    ).toBeUndefined();
  });

  it("still binds ChatGPT to Chiral when the picker explicitly named that account", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "gpt-5.6-sol",
        customModels: [{ provider: "codex", modelId: "gpt-5.6-sol", accountId: "tp-1" }],
        accounts,
        explicitAccountId: "tp-1",
      }),
    ).toBe("tp-1");
  });

  it("ignores a leftover Chiral next-session account on an official ChatGPT pick", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "gpt-5.4",
        customModels: [{ provider: "codex", modelId: "gpt-5.6-sol", accountId: "tp-1" }],
        accounts,
        explicitAccountId: "tp-1",
      }),
    ).toBeUndefined();
  });

  it("trusts account-bearing entries for main-side callers without an account roster", () => {
    // Agent-initiated create_thread has no roster: channel-exact entries with
    // an account resolve; the supervisor re-validates the record.
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "commandcode",
        model: "meta/muse-spark-1.3",
        customModels: [
          { provider: "commandcode", modelId: "meta/muse-spark-1.3", accountId: "tp-9" },
        ],
        trustAccountChannel: true,
      }),
    ).toBe("tp-9");
    // Native models still never resolve, even trusted.
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "commandcode",
        model: "deepseek-v4-flash",
        customModels: [{ provider: "commandcode", modelId: "deepseek-v4-flash" }],
        trustAccountChannel: true,
      }),
    ).toBeUndefined();
  });

  it("ignores entries whose account is not a third-party account", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "kimi",
        model: "k3-256k",
        customModels: [{ provider: "kimi", modelId: "k3-256k", accountId: "sub-1" }],
        accounts,
      }),
    ).toBeUndefined();
  });
  it("prefers the exact channel match when several accounts share a model id", () => {
    const multi = [
      ...accounts,
      { accountId: "tp-2", provider: "openai-compatible", enabled: true },
    ];
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "kimi",
        model: "k3-256k",
        customModels: [
          { provider: "codex", modelId: "k3-256k", accountId: "tp-1" },
          { provider: "kimi", modelId: "k3-256k", accountId: "tp-2" },
        ],
        accounts: multi,
      }),
    ).toBe("tp-2");
  });

  it("never hijacks a native launch when the model id only exists under other channels", () => {
    // Regression: a native Codex model id that also exists as a custom entry
    // filed under another harness must stay on the subscription/native path.
    // Falling back cross-channel used to route official Codex runtimes into
    // the third-party branch, where the unvalidated gate blocked them.
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "gpt-5.4",
        customModels: [{ provider: "kimi", modelId: "gpt-5.4", accountId: "tp-1" }],
        accounts,
      }),
    ).toBeUndefined();
  });

  it("keeps an explicit Muse Recipe launch on the original openai-compatible account", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "muse",
        model: "muse-spark-1.3-contributor",
        customModels: [
          {
            provider: "opencode",
            modelId: "opencode-go/muse-spark-1.3-contributor",
            accountId: "tp-1",
          },
        ],
        accounts,
      }),
    ).toBe("tp-1");
  });

  it("keeps a remapped GLM OpenCode launch on the original openai-compatible account", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "opencode",
        model: "glm-5.3-flash",
        customModels: [{ provider: "codex", modelId: "glm-5.3-flash", accountId: "tp-1" }],
        accounts,
      }),
    ).toBe("tp-1");
  });

  it("binds an unknown custom model on Devin so 阶跃星辰 can leave that harness", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "devin",
        model: "step-5-preview",
        customModels: [{ provider: "opencode", modelId: "step-5-preview", accountId: "tp-1" }],
        accounts,
      }),
    ).toBe("tp-1");
    expect(
      applyThirdPartyPickerSelection({
        agentKind: "devin",
        model: "step-5-preview",
        accountId: "openai-compatible:tp-1",
      }).agentKind,
    ).toBe("opencode");
  });

  it("does not pull a ChatGPT custom row onto Devin", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "devin",
        model: "gpt-5.4",
        customModels: [{ provider: "opencode", modelId: "gpt-5.4", accountId: "tp-1" }],
        accounts,
      }),
    ).toBeUndefined();
  });

  it("binds a Codex GLM launch even when the custom row was filed under OpenCode", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "glm-5.3-flash-C",
        customModels: [{ provider: "opencode", modelId: "glm-5.3-flash-C", accountId: "tp-1" }],
        accounts,
      }),
    ).toBe("tp-1");
  });

  it("honours an explicit third-party account over channel derivation for non-GPT models", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "glm-5.3-flash",
        customModels: [{ provider: "codex", modelId: "glm-5.3-flash", accountId: "tp-1" }],
        accounts,
        explicitAccountId: "tp-1",
      }),
    ).toBe("tp-1");
  });
});

describe("third-party picker harness", () => {
  it("maps ChatGPT to Codex, vendor models to their native Harness, and unknown to OpenCode", () => {
    expect(resolveThirdPartyHarnessForModel("gpt-5.6-sol")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("GPT-6-Astra")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("chatgpt-4o")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("glm-5.3-flash-C")).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("z-ai/glm-5.3-flash")).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("muse-spark-1.3-contributor")).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("k3-256k")).toBe("kimi");
    expect(resolveThirdPartyHarnessForModel("grok-4.6")).toBe("grok");
    expect(resolveThirdPartyHarnessForModel("deepseek-v4-flash")).toBe("deepseek");
    expect(resolveThirdPartyHarnessForModel("gemini-3.8-flash")).toBe("opencode");
  });

  it("falls back to OpenCode when the native vendor Harness is not installed", () => {
    expect(resolveThirdPartyHarnessForModel("k3-256k", ["opencode", "codex"])).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("grok-4.6", ["opencode"])).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("deepseek-v4-flash", ["opencode", "codex"])).toBe(
      "opencode",
    );
    expect(resolveThirdPartyHarnessForModel("k3-256k", ["kimi", "opencode"])).toBe("kimi");
    expect(resolveThirdPartyHarnessForModel("deepseek-v4-flash", ["deepseek", "opencode"])).toBe(
      "deepseek",
    );
    expect(resolveThirdPartyHarnessForModel("muse-spark-1.3-contributor", ["opencode"])).toBe(
      "opencode",
    );
  });

  it("rewrites a third-party Kimi pick onto Kimi Code when that Harness is installed", () => {
    expect(
      applyThirdPartyPickerSelection(
        {
          agentKind: "codex",
          model: "k3-256k",
          accountId: "openai-compatible:cavoti",
        },
        ["kimi", "opencode", "codex"],
      ),
    ).toEqual({
      agentKind: "kimi",
      model: "k3-256k",
      accountId: "openai-compatible:cavoti",
      sourceProviderKind: "codex",
    });
  });

  it("falls a third-party Kimi pick back to OpenCode when Kimi Code is missing", () => {
    expect(
      applyThirdPartyPickerSelection(
        {
          agentKind: "codex",
          model: "k3-256k",
          accountId: "openai-compatible:cavoti",
        },
        ["opencode", "codex"],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "k3-256k",
      accountId: "openai-compatible:cavoti",
      sourceProviderKind: "codex",
    });
  });

  it("rewrites a third-party GLM pick onto OpenCode and keeps the account and model id", () => {
    expect(
      applyThirdPartyPickerSelection({
        agentKind: "codex",
        model: "glm-5.3-flash-C",
        accountId: "openai-compatible:cavoti",
      }),
    ).toEqual({
      agentKind: "opencode",
      model: "glm-5.3-flash-C",
      accountId: "openai-compatible:cavoti",
      sourceProviderKind: "codex",
    });
  });

  it("does not rewrite a native OpenCode GLM catalog pick", () => {
    expect(
      applyThirdPartyPickerSelection({
        agentKind: "opencode",
        model: "glm-5.3-flash",
        accountId: "opencode:zhipu",
      }),
    ).toEqual({
      agentKind: "opencode",
      model: "glm-5.3-flash",
      accountId: "opencode:zhipu",
    });
  });

  it("keeps an authenticated OpenCode catalog Muse Spark pick on OpenCode", () => {
    expect(
      applyThirdPartyPickerSelection(
        {
          agentKind: "opencode",
          model: "opencode-go/muse-spark-1.3-contributor",
          accountId: "opencode:zhipu",
        },
        ["opencode", "muse"],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "opencode-go/muse-spark-1.3-contributor",
      accountId: "opencode:zhipu",
    });
  });

  it("keeps OpenCode Muse Spark on OpenCode when native muse.exe is missing", () => {
    expect(
      applyThirdPartyPickerSelection(
        {
          agentKind: "opencode",
          model: "opencode-go/muse-spark-1.3-contributor",
          accountId: "opencode:zhipu",
        },
        ["opencode"],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "opencode-go/muse-spark-1.3-contributor",
      accountId: "opencode:zhipu",
    });
  });

  it("keeps a third-party GPT pick on Codex with the channel account", () => {
    expect(
      applyThirdPartyPickerSelection({
        agentKind: "codex",
        model: "gpt-5.6-sol",
        accountId: "openai-compatible:chiral",
      }),
    ).toEqual({
      agentKind: "codex",
      model: "gpt-5.6-sol",
      accountId: "openai-compatible:chiral",
    });
  });

  it("remaps a Command Code DeepSeek catalog pick onto DeepSeek Harness", () => {
    expect(
      applyThirdPartyPickerSelection(
        { agentKind: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
        ["commandcode", "deepseek"],
      ),
    ).toEqual({
      agentKind: "deepseek",
      model: "deepseek/deepseek-v4.1-flash",
      sourceProviderKind: "commandcode",
    });
  });

  it("keeps a Command Code DeepSeek catalog pick on Command Code when dsh is missing", () => {
    expect(
      applyThirdPartyPickerSelection(
        { agentKind: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
        ["commandcode"],
      ),
    ).toEqual({ agentKind: "commandcode", model: "deepseek/deepseek-v4.1-flash" });
  });

  it("keeps a Command Code Muse catalog pick on Command Code", () => {
    expect(
      applyThirdPartyPickerSelection({ agentKind: "commandcode", model: "meta/muse-spark-1.3" }, [
        "commandcode",
        "muse",
      ]),
    ).toEqual({ agentKind: "commandcode", model: "meta/muse-spark-1.3" });
  });

  it("keeps an OpenCode catalog Muse Spark pick on OpenCode", () => {
    expect(
      applyThirdPartyPickerSelection(
        {
          agentKind: "opencode",
          model: "opencode-go/muse-spark-1.3-contributor",
          presentationMode: "gui",
        },
        ["opencode", "muse"],
      ),
    ).toEqual({
      agentKind: "opencode",
      model: "opencode-go/muse-spark-1.3-contributor",
      presentationMode: "gui",
    });
  });

  it("keeps picker identity on the catalog channel after Auto Mode remaps Harness", () => {
    expect(
      composerPickerAgentKind({
        agentKind: "deepseek",
        model: "deepseek/deepseek-v4.1-flash",
        sourceProviderKind: "commandcode",
      }),
    ).toBe("commandcode");
    expect(catalogProviderKind({ agentKind: "deepseek", sourceProviderKind: "commandcode" })).toBe(
      "commandcode",
    );
    expect(
      foreignAcpModelId({
        model: "deepseek/deepseek-v4.1-flash",
        sourceProviderKind: "commandcode",
      }),
    ).toBe(JSON.stringify(["commandcode", "deepseek/deepseek-v4.1-flash"]));
    expect(
      foreignAcpModelId({
        model: "commandcode/deepseek-v4-flash",
        sourceProviderKind: "commandcode",
      }),
    ).toBe(JSON.stringify(["commandcode", "deepseek/deepseek-v4-flash"]));
    expect(foreignAcpModelId({ model: "commandcode/deepseek-v4-flash" })).toBe(
      JSON.stringify(["commandcode", "deepseek/deepseek-v4-flash"]),
    );
    expect(foreignAcpModelId({ model: "gpt-5.6-sol" })).toBe("gpt-5.6-sol");
    expect(catalogProviderKind({ agentKind: "commandcode" })).toBe("commandcode");
    expect(
      resolveAutoModelBinding({ agentKind: "commandcode", model: "deepseek/deepseek-v4.1-flash" }, [
        "commandcode",
        "deepseek",
      ]),
    ).toEqual({
      harnessId: "deepseek",
      providerId: "commandcode",
      providerModelId: "deepseek/deepseek-v4.1-flash",
    });
    expect(
      resolveAutoModelBinding(
        { agentKind: "opencode", model: "opencode-go/muse-spark-1.3-contributor" },
        ["opencode", "muse"],
      ),
    ).toEqual({
      harnessId: "opencode",
      providerId: "opencode",
      providerModelId: "opencode-go/muse-spark-1.3-contributor",
    });
  });

  it("shows the spawn Harness for an explicit recipe, not the catalog the model card came from", () => {
    expect(
      composerPickerAgentKind({
        agentKind: "opencode",
        model: "gemini-3.8-flash",
        sourceProviderKind: "antigravity",
      }),
    ).toBe("opencode");
    expect(catalogProviderKind({ agentKind: "opencode", sourceProviderKind: "antigravity" })).toBe(
      "antigravity",
    );
  });

  it("does not rewrite a native subscription pick", () => {
    expect(applyThirdPartyPickerSelection({ agentKind: "codex", model: "gpt-5.6-sol" })).toEqual({
      agentKind: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("treats Chiral vs native Codex as different composer accounts", () => {
    expect(isThirdPartyAccountId("openai-compatible:chiral")).toBe(true);
    expect(isThirdPartyAccountId("codex:pool-1")).toBe(false);
    expect(sameComposerAccount("codex:pool-1", undefined)).toBe(true);
    expect(sameComposerAccount("codex:pool-1", "openai-compatible:chiral")).toBe(false);
    expect(sameComposerAccount("openai-compatible:chiral", "openai-compatible:chiral")).toBe(true);
  });
});

describe("normalizeCommandCodeModelId", () => {
  it("rewrites commandcode/<leaf> catalog ids onto known native vendor/model ids", () => {
    expect(normalizeCommandCodeModelId("commandcode/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
    expect(normalizeCommandCodeModelId("commandcode/kimi-k2.5")).toBe("moonshotai/kimi-k2.5");
    expect(normalizeCommandCodeModelId("commandcode/grok-4.6")).toBe("xai/grok-4.6");
    expect(normalizeCommandCodeModelId("commandcode/muse-spark-1.3")).toBe("meta/muse-spark-1.3");
    expect(normalizeCommandCodeModelId("commandcode/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeCommandCodeModelId("commandcode/deepseek/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
    expect(normalizeCommandCodeModelId("deepseek/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
  });

  it("does not invent a vendor for unknown leaves", () => {
    expect(normalizeCommandCodeModelId("commandcode/not-a-real-model")).toBe("not-a-real-model");
  });

  it("keeps a Command Code DeepSeek pick native when remapping onto dsh", () => {
    expect(
      applyThirdPartyPickerSelection(
        { agentKind: "commandcode", model: "commandcode/deepseek-v4-flash" },
        ["commandcode", "deepseek"],
      ),
    ).toEqual({
      agentKind: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      sourceProviderKind: "commandcode",
    });
  });
});

describe("model catalog channel", () => {
  it("derives the serving channel from a provider/model id", () => {
    expect(modelCatalogChannel("opencode-go/muse-spark-1.3-contributor")).toBe("opencode");
    expect(modelCatalogChannel("opencode/big-pickle")).toBe("opencode");
    expect(modelCatalogChannel("commandcode/deepseek-v4.1-flash")).toBe("commandcode");
    expect(modelCatalogChannel("muse-spark-1.2")).toBeUndefined();
    expect(modelCatalogChannel("gpt-5.6-sol")).toBeUndefined();
    expect(modelCatalogChannel(undefined)).toBeUndefined();
  });

  it("detects a foreign catalog model on a different Harness", () => {
    expect(isForeignCatalogModelForHarness("opencode-go/muse-spark-1.3-contributor", "muse")).toBe(
      true,
    );
    expect(isForeignCatalogModelForHarness("muse-spark-1.2", "muse")).toBe(false);
    expect(isForeignCatalogModelForHarness("opencode/big-pickle", "opencode")).toBe(false);
    expect(isForeignCatalogModelForHarness("opencode/big-pickle", "muse")).toBe(true);
    expect(isForeignCatalogModelForHarness(undefined, "muse")).toBe(false);
    expect(
      isForeignCatalogModelForHarness("opencode-go/muse-spark-1.3-contributor", undefined),
    ).toBe(false);
  });
});
