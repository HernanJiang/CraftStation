import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CraftingGrid } from "./CraftingGrid";
import { getDefaultRegistry, OPENAI_CODEX_RECIPE_ID, type CraftResult } from "@/shared/crafting";

function officialModels() {
  return getDefaultRegistry()
    .listItems("model")
    .filter((item) => item.metadata.vendor === "openai");
}

describe("CraftingGrid Component", () => {
  beforeEach(() => {
    getDefaultRegistry().refreshCodexModels([
      { id: "gpt-official-live", displayName: "GPT Official Live" },
      { id: "gpt-official-fast", displayName: "GPT Official Fast" },
    ]);
  });

  it("renders with default auto harness slot resolved to Codex", () => {
    const { container } = render(<CraftingGrid models={officialModels()} />);

    expect(screen.getByTestId("crafting-grid")).toBeDefined();
    expect(screen.getByTestId("model-slot")).toBeDefined();
    expect(screen.getByTestId("harness-slot")).toBeDefined();
    expect(screen.getByTestId("recipe-preview")).toBeDefined();
    expect(screen.getByTestId("craft-button")).toBeDefined();
    expect(container.querySelectorAll("[data-crafting-slot]")).toHaveLength(9);

    expect(screen.getByText(/Resolved: Codex Harness/)).toBeDefined();
    expect(screen.getByText("NATIVE")).toBeDefined();
    expect(screen.getByText("OpenAI Codex Native Recipe")).toBeDefined();
  });

  it("allows selecting a different model item", async () => {
    render(<CraftingGrid models={officialModels()} />);

    const modelSelect = screen.getByTestId("model-select") as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: "openai:gpt-official-fast" } });

    expect(modelSelect.value).toBe("openai:gpt-official-fast");
    expect(screen.getByText(/Produces: GPT Official Fast \+ Codex Harness/)).toBeDefined();
  });

  it("allows selecting explicit Codex harness", async () => {
    render(<CraftingGrid models={officialModels()} />);

    const harnessSelect = screen.getByTestId("harness-select") as HTMLSelectElement;
    fireEvent.change(harnessSelect, { target: { value: "harness:codex" } });

    expect(harnessSelect.value).toBe("harness:codex");
    expect(screen.getByText("OpenAI Codex Native Recipe")).toBeDefined();
  });

  it("calls onCraft with compiled CraftResult when craft button is clicked", async () => {
    const onCraftMock = vi
      .fn<(result: CraftResult, prompt: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const testWs = "/test/workspace";
    render(<CraftingGrid workspace={testWs} models={officialModels()} onCraft={onCraftMock} />);

    const promptInput = screen.getByTestId("craft-prompt-input");
    fireEvent.change(promptInput, { target: { value: "Implement feature X" } });

    const craftButton = screen.getByTestId("craft-button");
    fireEvent.click(craftButton);

    await waitFor(() => {
      expect(onCraftMock).toHaveBeenCalledTimes(1);
    });

    const [craftResult, prompt] = onCraftMock.mock.calls[0]!;
    expect(craftResult.success).toBe(true);
    expect(craftResult.craftPlan?.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(craftResult.craftPlan?.workspace).toBe(testWs);
    expect(craftResult.resultItem?.provenance.recipeId).toBe(OPENAI_CODEX_RECIPE_ID);
    expect(prompt).toBe("Implement feature X");
  });

  it.each([
    ["xAI Grok Build Native Recipe", "xai:grok-4.6", "harness:grok", "grok"],
    ["Moonshot Kimi Code Native Recipe", "moonshot:kimi-for-coding", "harness:kimi", "kimi"],
    [
      "Google Antigravity Native Recipe",
      "google:antigravity-default",
      "harness:antigravity",
      "antigravity",
    ],
    ["DeepSeek / DSH Native Recipe", "deepseek:deepseek-v4-flash", "harness:deepseek", "deepseek"],
  ] as const)(
    "quick-fills and compiles the %s",
    async (recipeName, modelId, harnessId, harnessKind) => {
      const onCraftMock = vi
        .fn<(result: CraftResult, prompt: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      render(
        <CraftingGrid models={getDefaultRegistry().listItems("model")} onCraft={onCraftMock} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "配方" }));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(recipeName, "u") }));

      expect((screen.getByTestId("model-select") as HTMLSelectElement).value).toBe(modelId);
      expect((screen.getByTestId("harness-select") as HTMLSelectElement).value).toBe(harnessId);
      expect(screen.getByText(new RegExp(`Resolved:.*${harnessKind}`, "iu"))).toBeDefined();

      fireEvent.click(screen.getByTestId("craft-button"));
      await waitFor(() => expect(onCraftMock).toHaveBeenCalledTimes(1));
      expect(onCraftMock.mock.calls[0]?.[0].craftPlan?.runtimeBinding.harnessKind).toBe(
        harnessKind,
      );
    },
  );
});
