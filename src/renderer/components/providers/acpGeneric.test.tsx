// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type { AgentCapability, ThreadConfig } from "@/shared/contracts";
import "./acpGeneric";
import { getComposerControls } from "./providerComposer";

const baseCapabilities: AgentCapability = {
  models: [{ id: "model-a", label: "Model A" }],
  efforts: [],
  modelEfforts: {},
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: false,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui"],
  settingDefs: [],
};

function buildControls(capabilities: AgentCapability, config: ThreadConfig = { model: "model-a" }) {
  const onConfigChange = vi.fn<(patch: Partial<ThreadConfig>) => void>();
  const factory = getComposerControls("acp-generic:example-agent");
  expect(factory).toBeDefined();
  return {
    controls: factory!({
      capabilities,
      config,
      isDisabled: false,
      onConfigChange,
      presentationMode: "gui",
    }),
    onConfigChange,
  };
}

type MenuControl = Extract<ComposerControl, { kind?: "menu" }>;

function isToggleControl(
  control: ComposerControl,
): control is Extract<ComposerControl, { kind: "toggle" }> {
  return control.kind === "toggle";
}

function isMenuControl(control: ComposerControl): control is MenuControl {
  return control.kind === undefined || control.kind === "menu";
}

describe("generic ACP composer controls", () => {
  it("uses generic controls for registry instance kinds", () => {
    const { controls, onConfigChange } = buildControls({
      ...baseCapabilities,
      approvalPolicies: [
        { id: "default", label: "Supervised" },
        { id: "never", label: "Auto Approve" },
      ],
    });

    const permission = controls.find(isToggleControl);
    expect(permission).toMatchObject({
      label: "Supervised",
      iconKind: "permission",
      isSelected: false,
    });

    if (!permission) {
      throw new Error("Expected permission toggle");
    }
    permission.onChange?.(true);
    expect(onConfigChange).toHaveBeenCalledWith({ approvalPolicy: "never" });
  });

  it("labels enabled synthetic bypass as auto approve", () => {
    const { controls } = buildControls(
      {
        ...baseCapabilities,
        approvalPolicies: [
          { id: "default", label: "Supervised" },
          { id: "never", label: "Auto Approve" },
        ],
      },
      { model: "model-a", approvalPolicy: "never" },
    );

    expect(controls.find(isToggleControl)).toMatchObject({
      label: "Auto Approve",
      iconKind: "permission",
      isSelected: true,
    });
  });

  it("renders default-only ACP approval policies as the generic toggle", () => {
    const { controls, onConfigChange } = buildControls({
      ...baseCapabilities,
      approvalPolicies: [{ id: "default", label: "Ask for permission" }],
    });

    const permission = controls.find(isToggleControl);
    expect(permission).toMatchObject({
      label: "Supervised",
      iconKind: "permission",
      isSelected: false,
    });

    if (!permission) {
      throw new Error("Expected permission toggle");
    }
    permission.onChange?.(true);
    expect(onConfigChange).toHaveBeenCalledWith({ approvalPolicy: "never" });
  });

  it("renders advertised ACP approval policies as a permission menu", () => {
    const { controls, onConfigChange } = buildControls(
      {
        ...baseCapabilities,
        approvalPolicies: [
          { id: "default", label: "Default" },
          { id: "auto_edit", label: "Auto edit" },
        ],
      },
      { model: "model-a", approvalPolicy: "auto_edit" },
    );

    const permission = controls.find(isMenuControl);
    expect(permission).toMatchObject({
      value: "auto_edit",
      iconKind: "permission",
    });

    if (!permission) {
      throw new Error("Expected permission menu");
    }
    permission.onChange?.("default");
    expect(onConfigChange).toHaveBeenCalledWith({ approvalPolicy: "default" });
  });
});
