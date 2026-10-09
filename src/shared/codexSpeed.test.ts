import { describe, expect, it } from "vitest";
import { codexUltrafastAccountRestriction } from "./codexSpeed";
import { mapCodexModels, mergeCodexCatalogModels } from "@/supervisor/agents/codex/probe";
import { mapCodexNotificationToRuntimeEvents } from "@/supervisor/runtime/nativeCodex/eventMapping";

const model = {
  id: "gpt-6.1-sol",
  model: "gpt-6.1-sol",
  displayName: "GPT-6.1 Sol",
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: "high",
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
  serviceTiers: [{ id: "priority", name: "Fast" }],
};
describe("GPT-6.1 Sol Ultrafast", () => {
  it("新账号目录更新已有模型的服务档位，空目录能够撤回旧档位", () => {
    const merged = mergeCodexCatalogModels(
      [model],
      {
        models: [
          {
            slug: model.id,
            visibility: "list",
            service_tiers: [{ id: "ultrafast", name: "Ultrafast" }],
            additional_speed_tiers: ["ultrafast"],
          },
        ],
      },
      [0, 170, 0],
    );
    expect(mapCodexModels(merged)).toMatchObject({
      fastModels: [model.id],
      modelFastTiers: { [model.id]: [{ id: "ultrafast", availability: "catalog" }] },
    });
    const withdrawn = mergeCodexCatalogModels(
      merged,
      {
        models: [
          { slug: model.id, visibility: "list", service_tiers: [], additional_speed_tiers: [] },
        ],
      },
      [0, 170, 0],
    );
    expect(mapCodexModels(withdrawn)).not.toHaveProperty("modelFastTiers");
  });
  it("旧目录缺少 Ultrafast 时只显示权限待确认", () => {
    expect(mapCodexModels([model])).toMatchObject({
      modelFastTiers: {
        [model.id]: [{ id: "priority" }, { id: "ultrafast", availability: "unverified" }],
      },
    });
  });
  it("套餐明显不符时拒绝；泛化 pro 标记不当作 Pro $500 权限证明", () => {
    for (const planType of ["free", "plus", "go", "team", "business"])
      expect(
        codexUltrafastAccountRestriction({ account: { type: "chatgpt", planType } }),
      ).toContain("CODEX_ULTRAFAST_UNAVAILABLE");
    for (const type of ["apiKey", "chatgpt"])
      expect(
        codexUltrafastAccountRestriction({ account: { type, planType: "pro" } }),
      ).toBeUndefined();
  });
  it("请求回显和成功回合不能证明实际 Ultrafast，明确实际字段才确认", () => {
    const context = { threadId: "t", requestedServiceTier: "ultrafast" };
    const start = mapCodexNotificationToRuntimeEvents(
      { method: "turn/started", params: { turn: { id: "turn1", serviceTier: "ultrafast" } } },
      context,
    );
    expect(start.at(-1)).toMatchObject({
      payload: { requested: "ultrafast", status: "requested" },
    });
    const finish = (actualServiceTier?: string) =>
      mapCodexNotificationToRuntimeEvents(
        {
          method: "turn/completed",
          params: {
            turn: {
              id: "turn1",
              status: "completed",
              serviceTier: "ultrafast",
              ...(actualServiceTier ? { actualServiceTier } : {}),
            },
          },
        },
        context,
      );
    expect(finish()[0]).toMatchObject({ payload: { status: "unknown" } });
    expect(finish("ultrafast")[0]).toMatchObject({
      payload: { status: "confirmed", actual: "ultrafast" },
    });
    expect(finish("default")[0]).toMatchObject({
      payload: { status: "downgraded", actual: "default" },
    });
  });
});
