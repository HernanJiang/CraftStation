import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { CustomModel } from "@/renderer/components/thread/customModelCatalog";
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

  it("edit mode: prefills fields, locks the model id and saves edited values", () => {
    const editingModel: CustomModel = {
      id: "custom:kimi:acct:kimi-k2.8-preview",
      provider: "kimi",
      accountId: "acct",
      modelId: "kimi-k2.8-preview",
      displayName: "K2.8",
      contextSize: "256K",
      maxOutputTokens: "64000",
      efforts: ["low", "high", "max"],
      defaultEffort: "high",
      inputModalities: ["text"],
      outputModalities: ["text"],
    };
    const onSave = vi.fn<() => void>();
    render(
      <CustomModelDialog
        open
        initialModelId=""
        initialDisplayName=""
        editingModel={editingModel}
        providerKind="kimi"
        onFetchUpstreamModels={() => Promise.resolve(["ignored"])}
        verifying={false}
        onCancel={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("编辑模型")).toBeInTheDocument();
    expect(screen.queryByText("添加模型")).not.toBeInTheDocument();
    // 模型 ID 在编辑模式锁定不可改。
    expect(screen.getByDisplayValue("kimi-k2.8-preview")).toBeDisabled();
    expect(screen.getByDisplayValue("K2.8")).toBeInTheDocument();
    expect(screen.getByDisplayValue("256K")).toBeInTheDocument();
    expect(screen.getByDisplayValue("64000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("low, high, max")).toBeInTheDocument();
    // 编辑模式隐藏上游拉取（否则可选出另一个模型 id，绕过锁定）。
    expect(screen.queryByRole("button", { name: /从上游拉取/u })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("K2.8"), { target: { value: "K2.8 Pro" } });
    fireEvent.change(screen.getByDisplayValue("256K"), { target: { value: "512K" } });
    fireEvent.change(screen.getByDisplayValue("low, high, max"), {
      target: { value: "low, high" },
    });
    const inputGroup = screen.getByRole("group", { name: "输入类型" });
    fireEvent.click(within(inputGroup).getByRole("checkbox", { name: /图片/u }));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({
      modelId: "kimi-k2.8-preview",
      displayName: "K2.8 Pro",
      contextSize: "512K",
      maxOutputTokens: "64000",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      efforts: ["low", "high"],
      defaultEffort: "high",
    });
  });
});
