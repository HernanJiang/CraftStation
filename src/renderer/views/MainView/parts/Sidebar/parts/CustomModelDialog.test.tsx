import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { CustomModelDialog } from "./CustomModelDialog";

describe("CustomModelDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CustomModelDialog
        open={false}
        initialModelId=""
        initialDisplayName=""
        providerKind="codex"
        verifying={false}
        onCancel={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows defaults and saves the filled values", () => {
    const onSave = vi.fn<() => void>();
    render(
      <CustomModelDialog
        open
        initialModelId="gpt-5.6-sol"
        initialDisplayName=""
        providerKind="codex"
        verifying={false}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getByDisplayValue("gpt-5.6-sol")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("128000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({
      modelId: "gpt-5.6-sol",
      displayName: "",
      contextSize: "1000000",
      maxOutputTokens: "128000",
      inputModalities: ["text"],
      outputModalities: ["text"],
      efforts: [],
      defaultEffort: "",
    });
  });

  it("applies the vendor preset tiers", () => {
    const onSave = vi.fn<() => void>();
    render(
      <CustomModelDialog
        open
        initialModelId="x"
        initialDisplayName=""
        providerKind="codex"
        verifying={false}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /用codex预设/u }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        defaultEffort: "high",
      }),
    );
  });
});
