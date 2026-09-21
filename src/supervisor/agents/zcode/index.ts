import type { PromptSegment } from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { detectAgentInstall, type AgentAdapter } from "../base";
import { buildZCodeArgs, ZCODE_DEFAULT_MODEL_ID } from "./argv";
import { zcodeDefaultCapabilities, zcodeDetectionSpec } from "./detection";
import { detectZCodeTerminalStatus } from "./terminal";

export function createZCodeAdapter(): AgentAdapter {
  let capabilities = zcodeDefaultCapabilities;
  return {
    kind: zcodeDetectionSpec.kind,
    label: zcodeDetectionSpec.label,
    binary: zcodeDetectionSpec.binary,
    skillSupport: {
      roots: [
        {
          id: "zcode",
          label: zcodeDetectionSpec.label,
          globalPath: ".zcode/skills",
          projectPath: ".zcode/skills",
        },
        {
          id: "agents",
          label: "Shared agent skills",
          globalPath: ".agents/skills",
          projectPath: ".agents/skills",
        },
      ],
      invocation: "slash",
      precedence: { global: ["zcode", "agents"], project: ["zcode", "agents"] },
    },
    get capabilities() {
      return capabilities;
    },
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, zcodeDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv(_location, config, prompt) {
      return { binary: "zcode", args: buildZCodeArgs(config, prompt) };
    },
    buildResumeArgv(_location, config, prompt, sessionRef) {
      return {
        binary: "zcode",
        args: buildZCodeArgs(config, prompt, sessionRef?.providerSessionId || ""),
      };
    },
    createInitialSessionRef() {
      return undefined;
    },
    buildDirectInput(prompt) {
      return [prompt, "@wait:80", "\r"];
    },
    formatPromptSegments(segments: PromptSegment[]) {
      const attachments = segments.filter((segment) => segment.kind === "attachment");
      const rest = segments.filter((segment) => segment.kind !== "attachment");
      const attachmentLines = attachments.map((segment) => `@${segment.path}`).join(" ");
      const restText = rest.map(inlinePromptSegmentText).join("");
      return attachmentLines ? `${restText}\n\n${attachmentLines} ` : restText;
    },
    detectTerminalStatus: detectZCodeTerminalStatus,
    defaultOneShotModel: ZCODE_DEFAULT_MODEL_ID,
    buildOneShotCommand(_model, _effort, prompt) {
      return prompt
        ? {
            command: "zcode",
            args: ["--prompt", prompt, "--output-format", "json", "--no-color"],
            stdin: "",
          }
        : undefined;
    },
  };
}
