import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { ThreadConfig } from "@/shared/contracts";
import { describe, expect, it, vi } from "vitest";
import { resolveModelConfigValue } from "./sessionConfig";
import { AcpSessionConfigSync } from "./sessionConfigSync";

/**
 * The official DeepSeek Harness (dsh --profile acp) advertises its model
 * selector as JSON `[provider, model]` tuple wire values, e.g.
 * `["deepseek-official","deepseek-flash"]`. CraftStation catalog ids must
 * resolve to the exact advertised wire value — never fall through to the
 * runtime default model.
 */

const DSH_MODEL_OPTION = {
  id: "model",
  category: "model",
  type: "select",
  currentValue: '["deepseek-official","deepseek-v4-flash"]',
  options: [
    { value: '["deepseek-official","deepseek-flash"]', name: "DeepSeek-V41-Flash" },
    { value: '["deepseek-official","deepseek-v4-flash"]', name: "DeepSeek-V4-Flash" },
    { value: '["deepseek-official","deepseek-v4-pro"]', name: "DeepSeek-V4-Pro" },
  ],
};

const CC_MODEL_OPTION = {
  id: "model",
  category: "model",
  type: "select",
  currentValue: '["commandcode","deepseek/deepseek-v4.1-flash"]',
  options: [
    {
      value: '["commandcode","deepseek/deepseek-v4.1-flash"]',
      name: "DeepSeek V4.1 Flash (Command Code)",
    },
  ],
};

function config(model: string, sourceProviderKind?: string): ThreadConfig {
  return {
    model,
    effort: "high",
    mode: "agent",
    approvalPolicy: "default",
    ...(sourceProviderKind ? { sourceProviderKind } : {}),
  } as ThreadConfig;
}

describe("dsh ACP model wire values", () => {
  it("resolves the catalog id deepseek-flash to the exact advertised tuple", () => {
    const resolved = resolveModelConfigValue(
      config("deepseek-flash"),
      [DSH_MODEL_OPTION],
    );
    expect(resolved).toEqual({
      configId: "model",
      value: '["deepseek-official","deepseek-flash"]',
      currentValue: '["deepseek-official","deepseek-v4-flash"]',
    });
  });

  it("resolves official ids to their own advertised tuple", () => {
    const resolved = resolveModelConfigValue(
      config("deepseek-v4-pro"),
      [DSH_MODEL_OPTION],
    );
    expect(resolved?.value).toBe('["deepseek-official","deepseek-v4-pro"]');
  });

  it("resolves the catalog alias deepseek-v4.1-flash onto the advertised deepseek-flash tuple", () => {
    const resolved = resolveModelConfigValue(
      config("deepseek-v4.1-flash"),
      [DSH_MODEL_OPTION],
    );
    expect(resolved?.value).toBe('["deepseek-official","deepseek-flash"]');
  });

  it("resolves a full wire-value catalog id back to the identical wire value", () => {
    const resolved = resolveModelConfigValue(
      config('["deepseek-official","deepseek-flash"]'),
      [DSH_MODEL_OPTION],
    );
    expect(resolved?.value).toBe('["deepseek-official","deepseek-flash"]');
  });

  it("resolves Command Code catalog ids onto the commandcode provider tuple", () => {
    const resolved = resolveModelConfigValue(
      config("deepseek/deepseek-v4.1-flash", "commandcode"),
      [CC_MODEL_OPTION],
    );
    expect(resolved?.value).toBe('["commandcode","deepseek/deepseek-v4.1-flash"]');
  });

  it("rewrites commandcode/deepseek-v4-flash onto the native Command Code tuple", () => {
    const options = {
      ...CC_MODEL_OPTION,
      currentValue: '["commandcode","deepseek/deepseek-v4-flash"]',
      options: [
        {
          value: '["commandcode","deepseek/deepseek-v4-flash"]',
          name: "DeepSeek V4 Flash (Command Code)",
        },
      ],
    };
    const resolved = resolveModelConfigValue(config("commandcode/deepseek-v4-flash", "commandcode"), [
      options,
    ]);
    expect(resolved?.value).toBe('["commandcode","deepseek/deepseek-v4-flash"]');
    expect(resolved?.value).not.toContain("anthropic:");
  });

  it("does not match a catalog id the runtime does not advertise", () => {
    expect(resolveModelConfigValue(config("deepseek-v4.1-pro"), [DSH_MODEL_OPTION])).toBeUndefined();
    expect(resolveModelConfigValue(config("gpt-5.6-sol"), [DSH_MODEL_OPTION])).toBeUndefined();
  });
});

describe("AcpSessionConfigSync strict model binding", () => {
  function makeStrictSync(configOptions: unknown[]) {
    const connection = {
      setSessionMode: vi.fn().mockResolvedValue(undefined),
      setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions }),
      request: vi.fn().mockResolvedValue(undefined),
    };
    const sync = new AcpSessionConfigSync(connection as unknown as ClientSideConnection, {
      strictModelResolution: true,
    });
    sync.rememberOptions(["agent"], configOptions);
    return { connection, sync };
  }

  const previousConfig: ThreadConfig = {
    model: "deepseek-v4-flash",
    effort: "high",
    mode: "agent",
    approvalPolicy: "default",
  };

  it("sets the exact tuple wire value for an advertised catalog id", async () => {
    const { connection, sync } = makeStrictSync([DSH_MODEL_OPTION]);
    const next = config("deepseek-flash");
    await expect(sync.applyTurnConfig("session-1", next, previousConfig)).resolves.toEqual(next);
    expect(connection.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "model",
      value: '["deepseek-official","deepseek-flash"]',
    });
    expect(connection.request).not.toHaveBeenCalled();
  });

  it("fails closed when the requested model is not advertised by the runtime", async () => {
    const { connection, sync } = makeStrictSync([DSH_MODEL_OPTION]);
    const next = config("deepseek-v4.1-pro");
    await expect(sync.applyTurnConfig("session-1", next, previousConfig)).rejects.toThrow(
      /deepseek-v4\.1-pro/,
    );
    // Never silently continue on the runtime default model.
    expect(connection.setSessionConfigOption).not.toHaveBeenCalled();
    expect(connection.request).not.toHaveBeenCalled();
  });

  it("fails closed when the runtime offers no model selector at all", async () => {
    const { connection, sync } = makeStrictSync([]);
    const next = config("deepseek-flash");
    await expect(sync.applyTurnConfig("session-1", next, previousConfig)).rejects.toThrow(
      /deepseek-flash/,
    );
    expect(connection.request).not.toHaveBeenCalled();
  });
});
