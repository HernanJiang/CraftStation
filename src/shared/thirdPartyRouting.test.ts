import { describe, expect, it } from "vitest";
import {
  applyThirdPartyPickerSelection,
  isThirdPartyAccountId,
  normalizeThirdPartyModelId,
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

  it("binds a validated third-party model to its account (no pool lookup)", () => {
    expect(
      resolveThirdPartyAccountForLaunch({
        agentKind: "codex",
        model: "gpt-5.6-sol",
        customModels: [{ provider: "codex", modelId: "gpt-5.6-sol", accountId: "tp-1" }],
        accounts,
      }),
    ).toBe("tp-1");
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

  it("keeps a remapped Muse launch on the original openai-compatible account", () => {
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

  it("honours an explicit third-party account over channel derivation", () => {
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
});

describe("third-party picker harness", () => {
  it("maps ChatGPT to Codex, vendor models to their native Harness, and unknown to OpenCode", () => {
    expect(resolveThirdPartyHarnessForModel("gpt-5.6-sol")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("GPT-6-Astra")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("chatgpt-4o")).toBe("codex");
    expect(resolveThirdPartyHarnessForModel("glm-5.3-flash-C")).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("z-ai/glm-5.3-flash")).toBe("opencode");
    expect(resolveThirdPartyHarnessForModel("muse-spark-1.3-contributor")).toBe("muse");
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

  it("rewrites an OpenCode catalog Muse Spark pick onto Muse Code when installed", () => {
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
      agentKind: "muse",
      model: "opencode-go/muse-spark-1.3-contributor",
      accountId: "opencode:zhipu",
    });
  });

  it("keeps an OpenCode catalog Muse Spark pick on OpenCode when Muse is missing", () => {
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

  it("does not rewrite a native Command Code DeepSeek catalog pick", () => {
    expect(
      applyThirdPartyPickerSelection({ agentKind: "commandcode", model: "deepseek-v4.1-flash" }, [
        "commandcode",
        "deepseek",
      ]),
    ).toEqual({ agentKind: "commandcode", model: "deepseek-v4.1-flash" });
  });

  it("does not rewrite a native Command Code Muse catalog pick", () => {
    expect(
      applyThirdPartyPickerSelection({ agentKind: "commandcode", model: "meta/muse-spark-1.3" }, [
        "commandcode",
        "muse",
      ]),
    ).toEqual({ agentKind: "commandcode", model: "meta/muse-spark-1.3" });
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
