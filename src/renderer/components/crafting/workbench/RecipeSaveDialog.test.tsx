import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import type { CapabilityResolution } from "@/shared/crafting/workbenchTypes";
import { RecipeSaveDialog } from "./RecipeSaveDialog";

describe("RecipeSaveDialog", () => {
  it("lets a compatible bridge recipe be saved without claiming native verification", () => {
    const onSave = vi.fn<(alias?: string) => void>();
    renderWithI18n(
      <RecipeSaveDialog
        open
        systemName="Codex · Gemini"
        resolution={
          {
            status: "CRAFTABLE",
            diagnostics: [],
          } as unknown as CapabilityResolution
        }
        duplicateCount={0}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    const button = screen.getByTestId("confirm-save-recipe");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledOnce();
  });
  it("does not save an incompatible recipe through the Enter shortcut", () => {
    const onSave = vi.fn<(alias?: string) => void>();
    renderWithI18n(
      <RecipeSaveDialog
        open
        systemName="Unsupported"
        resolution={
          {
            status: "IMPOSSIBLE",
            diagnostics: [],
          } as unknown as CapabilityResolution
        }
        duplicateCount={0}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    fireEvent.keyDown(screen.getByPlaceholderText("例如：日常编码组合"), { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });
});
