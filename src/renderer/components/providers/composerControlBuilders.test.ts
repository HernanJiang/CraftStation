import { describe, expect, it } from "vitest";
import type { AgentCapability } from "@/shared/contracts";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import {
  approvalPolicyDropdown,
  buildAcpComposerControls,
  standardPlanApprovalControls,
} from "./composerControlBuilders";

const capabilities = {
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Default" },
    { id: "yolo", label: "Bypass Permissions" },
  ],
  bypassPermissions: { approvalPolicy: "yolo" },
} as unknown as AgentCapability;

const config = { model: "m" } as never;

function readPermissionMenuFullAccessId(controls: readonly ComposerControl[]): string | undefined {
  for (const control of controls) {
    const candidate = control as { iconKind?: string; fullAccessPolicyId?: string };
    if (candidate.iconKind === "permission" && "fullAccessPolicyId" in candidate) {
      return candidate.fullAccessPolicyId;
    }
  }
  return undefined;
}

describe("approval policy full-access wiring", () => {
  it("stamps the harness bypass id onto the dropdown control", () => {
    const control = approvalPolicyDropdown({
      policies: capabilities.approvalPolicies,
      currentPolicy: "default",
      fullAccessPolicyId: "yolo",
      isDisabled: false,
      onChange: () => undefined,
    });
    expect(control).toMatchObject({ fullAccessPolicyId: "yolo" });
    expect(control).not.toHaveProperty("kind");
  });

  it("omits the field when no bypass id is provided", () => {
    const control = approvalPolicyDropdown({
      policies: capabilities.approvalPolicies,
      currentPolicy: "default",
      isDisabled: false,
      onChange: () => undefined,
    });
    expect(control).not.toHaveProperty("fullAccessPolicyId");
  });

  it("standard plan+approval controls carry the bypass id", () => {
    const controls = standardPlanApprovalControls({
      capabilities,
      config,
      isDisabled: false,
      onConfigChange: () => undefined,
    });
    expect(readPermissionMenuFullAccessId(controls)).toBe("yolo");
  });

  it("ACP composer controls carry the bypass id", () => {
    const controls = buildAcpComposerControls({
      capabilities: { ...capabilities, modes: ["agent"] as never },
      config,
      isDisabled: false,
      onConfigChange: () => undefined,
    });
    expect(readPermissionMenuFullAccessId(controls)).toBe("yolo");
  });
});
