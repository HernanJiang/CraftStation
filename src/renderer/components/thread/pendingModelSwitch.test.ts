import { describe, expect, it } from "vitest";
import {
  isPendingSwitchResolved,
  shouldStageModelSwitch,
  type PendingModelSwitch,
} from "./pendingModelSwitch";

describe("pendingModelSwitch", () => {
  it("stages cross-provider and cross-model picks, ignores no-op picks", () => {
    const live = { agentKind: "opencode", model: "muse-spark" };
    expect(shouldStageModelSwitch(live, { agentKind: "opencode", model: "muse-spark" })).toBe(false);
    expect(shouldStageModelSwitch(live, { agentKind: "antigravity", model: "gemini-3.8-flash" })).toBe(
      true,
    );
    expect(shouldStageModelSwitch(live, { agentKind: "opencode", model: "other-model" })).toBe(true);
  });

  it("resolves only on exact agentKind + model match", () => {
    const pending: PendingModelSwitch = { agentKind: "antigravity", model: "gemini-3.8-flash" };
    expect(
      isPendingSwitchResolved({ agentKind: "antigravity", model: "gemini-3.8-flash" }, pending),
    ).toBe(true);
    expect(
      isPendingSwitchResolved({ agentKind: "opencode", model: "gemini-3.8-flash" }, pending),
    ).toBe(false);
    expect(
      isPendingSwitchResolved({ agentKind: "antigravity", model: "other" }, pending),
    ).toBe(false);
  });

  it("stages a third-party channel pick even when agentKind and model match native Codex", () => {
    const live = { agentKind: "codex", model: "gpt-5.6-sol", accountId: "codex:pool" };
    expect(
      shouldStageModelSwitch(live, {
        agentKind: "codex",
        model: "gpt-5.6-sol",
        accountId: "openai-compatible:chiral",
      }),
    ).toBe(true);
    expect(
      isPendingSwitchResolved(live, {
        agentKind: "codex",
        model: "gpt-5.6-sol",
        accountId: "openai-compatible:chiral",
      }),
    ).toBe(false);
  });
});
