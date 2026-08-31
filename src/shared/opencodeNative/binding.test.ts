import { describe, expect, it } from "vitest";
import {
  bindOpenCodeModel,
  buildOpenCodeCompatibilityMatrix,
  redactOpenCodeBinding,
} from "./binding";
import type { Item } from "@/shared/crafting";

function model(vendor: string, modelId: string): Item {
  return {
    id: `${vendor}:${modelId}`,
    kind: "model",
    metadata: {
      id: `${vendor}:${modelId}`,
      name: modelId,
      version: "audit",
      vendor,
      source: "test",
      description: "",
      compatibilityStatus: "NATIVE",
    },
    components: [{ kind: "model_capability", vendor, modelId }],
  };
}

describe("OpenCode ModelProviderBinding", () => {
  it("keeps provider, model, auth and Kimi route explicit", () => {
    const binding = bindOpenCodeModel({
      model: model("moonshot", "kimi-k2.5"),
      kimiRoute: "openai-compatible",
      authRef: "auth:moonshot-work",
      profileRef: "profile:work",
    });
    expect(binding).toMatchObject({
      providerID: "moonshot-openai-compatible",
      modelID: "kimi-k2.5",
      kimiRoute: "openai-compatible",
    });
    const safe = redactOpenCodeBinding(binding);
    expect(JSON.stringify(safe)).not.toContain("auth:moonshot-work");
    expect(safe).toMatchObject({ authConfigured: true, profileConfigured: true });
  });

  it("does not make a DeepSeek model look like the DSH Harness", () => {
    expect(bindOpenCodeModel({ model: model("deepseek", "deepseek-v4-flash") })).toMatchObject({
      harnessKind: "opencode",
      providerID: "deepseek",
    });
  });

  it("includes both Kimi routes and leaves un-smoked combinations unavailable", () => {
    const matrix = buildOpenCodeCompatibilityMatrix();
    expect(matrix.filter((entry) => entry.family === "moonshot")).toHaveLength(2);
    expect(matrix.every((entry) => entry.status === "unavailable")).toBe(true);
  });
});
