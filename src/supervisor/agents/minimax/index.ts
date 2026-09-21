import type { PromptSegment } from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { createAcpStructuredSession } from "../acp";
import {
  detectAgentInstall,
  detectProbeLocation,
  type AgentAdapter,
  type AgentEnvContext,
  type CreateStructuredSessionInput,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { buildMiniMaxArgs, MINIMAX_DEFAULT_MODEL_ID } from "./argv";
import { buildMiniMaxCommand, minimaxDefaultCapabilities, minimaxDetectionSpec } from "./detection";

export function createMiniMaxAdapter(): AgentAdapter {
  let capabilities = minimaxDefaultCapabilities;
  return {
    kind: minimaxDetectionSpec.kind,
    label: minimaxDetectionSpec.label,
    binary: minimaxDetectionSpec.binary,
    skillSupport: {
      roots: [
        {
          id: "minimax",
          label: minimaxDetectionSpec.label,
          globalPath: ".minimax/skills",
          projectPath: ".minimax/skills",
        },
        {
          id: "agents",
          label: "Shared agent skills",
          globalPath: ".agents/skills",
          projectPath: ".agents/skills",
        },
      ],
      invocation: "slash",
      precedence: { global: ["minimax", "agents"], project: ["minimax", "agents"] },
    },
    ...(minimaxDetectionSpec.update ? { update: minimaxDetectionSpec.update } : {}),
    get capabilities() {
      return capabilities;
    },
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, minimaxDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv(_location, config, prompt) {
      return { binary: "mcode", args: buildMiniMaxArgs(config, prompt) };
    },
    buildResumeArgv(_location, config, prompt) {
      return { binary: "mcode", args: buildMiniMaxArgs(config, prompt, true) };
    },
    async createStructuredSession(input: CreateStructuredSessionInput) {
      const command = buildMiniMaxCommand(
        input.projectLocation,
        ["acp"],
        resolveAgentBinaryPath(input.projectLocation, "mcode"),
      );
      return createAcpStructuredSession(command, input);
    },
    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      return buildMiniMaxCommand(location, ["acp"], resolveAgentBinaryPath(location, "mcode"));
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
    defaultOneShotModel: MINIMAX_DEFAULT_MODEL_ID,
    buildOneShotCommand(_model, _effort, prompt) {
      return prompt ? { command: "mcode", args: ["exec", prompt], stdin: "" } : undefined;
    },
  };
}
