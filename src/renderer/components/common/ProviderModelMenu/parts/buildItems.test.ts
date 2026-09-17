import { describe, expect, it } from "vitest";
import { buildProviderModelItems, type ProviderModelMenuProvider } from "./buildItems";

function provider(
  kind: string,
  label: string,
  modelIds: string[],
  extra?: Partial<ProviderModelMenuProvider>,
): ProviderModelMenuProvider {
  return {
    kind,
    label,
    capabilities: {
      models: modelIds.map((id) => ({ id, label: id })),
      efforts: [],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
    },
    ...extra,
  };
}

describe("buildProviderModelItems unconfigured filtering", () => {
  it("hides channels the user never configured", () => {
    const items = buildProviderModelItems({
      providers: [
        provider("codex", "Codex", ["gpt-5.6-sol"]),
        provider("muse", "Muse Code", ["muse-spark-1.2"], { unconfigured: true }),
      ],
      search: "",
    });
    const kinds = items
      .filter((i) => i.type === "model")
      .map((i) => (i as { providerKind: string }).providerKind);
    expect(kinds).toEqual(["codex"]);
  });

  it("keeps the current selection visible even when unconfigured", () => {
    const items = buildProviderModelItems({
      providers: [provider("muse", "Muse Code", ["muse-spark-1.2"], { unconfigured: true })],
      search: "",
      currentAgentKind: "muse",
      currentModel: "muse-spark-1.2",
    });
    expect(
      items.filter((i) => i.type === "model").map((i) => (i as { modelId: string }).modelId),
    ).toEqual(["muse-spark-1.2"]);
  });

  it("shows a setup hint instead of a dead empty menu", () => {
    const items = buildProviderModelItems({
      providers: [provider("muse", "Muse Code", ["muse-spark-1.2"], { unconfigured: true })],
      search: "",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "header-plain", id: "header:empty" });
  });

  it("does not show the hint while searching", () => {
    const items = buildProviderModelItems({
      providers: [provider("muse", "Muse Code", ["muse-spark-1.2"], { unconfigured: true })],
      search: "muse",
    });
    expect(items).toEqual([]);
  });
});
