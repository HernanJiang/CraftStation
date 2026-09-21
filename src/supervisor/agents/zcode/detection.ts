import type { AgentCapability } from "@/shared/contracts";
import { type DetectionSpec } from "../base";
import { ZCODE_DEFAULT_MODEL_ID } from "./argv";

export const zcodeDefaultCapabilities: AgentCapability = {
  models: [{ id: ZCODE_DEFAULT_MODEL_ID, label: "GLM-5.3" }],
  efforts: [],
  modelEfforts: {},
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "auto", label: "Auto" },
    { id: "yolo", label: "Full Access" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsOneShot: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  presentationModes: ["terminal"],
  defaultApprovalPolicy: "auto",
  bypassPermissions: { approvalPolicy: "yolo" },
  mcpScope: { terminal: "none", gui: "none" },
  settingDefs: [],
};

export const zcodeDetectionSpec: DetectionSpec = {
  kind: "zcode",
  label: "ZCode",
  binary: "zcode",
  loginCommand: "zcode login",
  capabilities: zcodeDefaultCapabilities,
  versionArgs: ["--version"],
};
