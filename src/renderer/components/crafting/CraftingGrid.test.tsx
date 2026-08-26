import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CraftingGrid } from "./CraftingGrid";
import { OPENAI_CODEX_RECIPE_ID, type CraftResult } from "@/shared/crafting";

describe("CraftingGrid Component", () => {
  it("renders with default auto harness slot resolved to Codex", () => {
    const { container } = render(<CraftingGrid />);

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
    render(<CraftingGrid />);

    const modelSelect = screen.getByTestId("model-select") as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: "openai:gpt-4o" } });

    expect(modelSelect.value).toBe("openai:gpt-4o");
    expect(screen.getByText(/Produces: GPT-4o \+ Codex Harness/)).toBeDefined();
  });

  it("allows selecting explicit Codex harness", async () => {
    render(<CraftingGrid />);

    const harnessSelect = screen.getByTestId("harness-select") as HTMLSelectElement;
    fireEvent.change(harnessSelect, { target: { value: "harness:codex" } });

    expect(harnessSelect.value).toBe("harness:codex");
    expect(screen.getByText("OpenAI Codex Native Recipe")).toBeDefined();
  });

  it("calls onCraft with compiled CraftResult when craft button is clicked", async () => {
    const onCraftMock = vi.fn<(result: CraftResult, prompt: string) => Promise<void>>().mockResolvedValue(undefined);
    const testWs = "/test/workspace";
    render(<CraftingGrid workspace={testWs} onCraft={onCraftMock} />);

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
});
