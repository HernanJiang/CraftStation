import type { PromptSegment, ThreadConfig } from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { createAcpStructuredSession } from "../acp";
import {
  detectAgentInstall,
  detectProbeLocation,
  inheritBaseSpawnEnv,
  type AgentAdapter,
  type AgentEnvContext,
  type CreateStructuredSessionInput,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { buildDevinAcpArgs, buildDevinArgs, buildDevinPrintArgs } from "./argv";
import {
  buildDevinCommand,
  defaultDevinCapabilities,
  DEVIN_DEFAULT_MODEL_ID,
  devinDetectionSpec,
} from "./detection";
import { detectDevinTerminalStatus } from "./terminal";

export function createDevinAdapter(): AgentAdapter {
  let capabilities = defaultDevinCapabilities;

  return {
    kind: devinDetectionSpec.kind,
    label: devinDetectionSpec.label,
    binary: devinDetectionSpec.binary,
    skillSupport: {
      roots: [
        {
          id: "devin",
          label: devinDetectionSpec.label,
          globalPath: ".devin/skills",
          projectPath: ".devin/skills",
        },
        {
          id: "agents",
          label: "Shared agent skills",
          globalPath: ".agents/skills",
          projectPath: ".agents/skills",
        },
      ],
      invocation: "slash",
      precedence: {
        global: ["devin", "agents"],
        project: ["devin", "agents"],
      },
    },
    ...(devinDetectionSpec.update ? { update: devinDetectionSpec.update } : {}),
    ...inheritBaseSpawnEnv(devinDetectionSpec),
    get capabilities() {
      return capabilities;
    },
    spawnEnv: {
      wsl: { BROWSER: "/bin/true" },
    },

    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, devinDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(_location, config, prompt) {
      return { binary: "devin", args: buildDevinArgs(config, prompt) };
    },

    buildResumeArgv(_location, config, prompt, sessionRef) {
      const id = sessionRef?.providerSessionId?.trim();
      return { binary: "devin", args: buildDevinArgs(config, prompt, id || "") };
    },

    createInitialSessionRef() {
      return undefined;
    },

    async createStructuredSession(input: CreateStructuredSessionInput) {
      const command = buildDevinCommand(
        input.projectLocation,
        buildDevinAcpArgs(input.config),
        resolveAgentBinaryPath(input.projectLocation, "devin"),
      );
      // Devin ACP `session/new` accepts HTTP MCP even when initialize omits
      // mcpCapabilities (same pattern as Factory Droid). CraftStation's built-in
      // Schedule / cross-thread / custom MCP servers are all HTTP.
      return createAcpStructuredSession(command, input, {
        assumedMcpCapabilities: { http: true },
      });
    },

    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      return buildDevinCommand(
        location,
        [...buildDevinAcpArgs({} as ThreadConfig)],
        resolveAgentBinaryPath(location, "devin"),
      );
    },

    async buildAcpLogoutCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      return buildDevinCommand(
        location,
        ["auth", "logout"],
        resolveAgentBinaryPath(location, "devin"),
      );
    },

    buildDirectInput(prompt) {
      return [prompt, "@wait:80", "\r"];
    },

    formatPromptSegments(segments: PromptSegment[]) {
      const attachments = segments.filter((segment) => segment.kind === "attachment");
      const rest = segments.filter((segment) => segment.kind !== "attachment");
      const attachmentLines = attachments.map((segment) => `@${segment.path}`).join(" ");
      const restStr = rest.map(inlinePromptSegmentText).join("");
      return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
    },

    detectTerminalStatus: detectDevinTerminalStatus,

    defaultOneShotModel: DEVIN_DEFAULT_MODEL_ID,
    buildOneShotCommand(model, _effort, prompt) {
      if (!prompt) return undefined;
      return {
        command: "devin",
        args: buildDevinPrintArgs({ model: model || DEVIN_DEFAULT_MODEL_ID }, prompt),
        stdin: "",
      };
    },
  };
}
