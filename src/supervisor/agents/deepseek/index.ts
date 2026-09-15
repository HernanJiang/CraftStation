import { createAcpStructuredSession } from "../acp";
import {
  detectAgentInstall,
  detectProbeLocation,
  type AgentAdapter,
  type AgentEnvContext,
  type CreateStructuredSessionInput,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import {
  buildDeepSeekCommand,
  DEEPSEEK_ACP_ARGS,
  deepseekDefaultCapabilities,
  deepseekDetectionSpec,
} from "./detection";

export function createDeepSeekAdapter(): AgentAdapter {
  let capabilities = deepseekDefaultCapabilities;

  return {
    kind: deepseekDetectionSpec.kind,
    label: deepseekDetectionSpec.label,
    binary: deepseekDetectionSpec.binary,
    skillSupport: {
      roots: [
        {
          id: "deepseek",
          label: deepseekDetectionSpec.label,
          globalPath: ".dsh/skills",
          projectPath: ".dsh/skills",
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
        global: ["deepseek", "agents"],
        project: ["deepseek", "agents"],
      },
    },
    ...(deepseekDetectionSpec.update ? { update: deepseekDetectionSpec.update } : {}),
    get capabilities() {
      return capabilities;
    },
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, deepseekDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv() {
      return { binary: "dsh", args: [...DEEPSEEK_ACP_ARGS] };
    },
    buildResumeArgv() {
      return { binary: "dsh", args: [...DEEPSEEK_ACP_ARGS] };
    },
    createInitialSessionRef() {
      return undefined;
    },
    async createStructuredSession(input: CreateStructuredSessionInput) {
      const command = buildDeepSeekCommand(
        input.projectLocation,
        [...DEEPSEEK_ACP_ARGS],
        resolveAgentBinaryPath(input.projectLocation, "dsh"),
      );
      // dsh silently keeps serving its configured default model when the
      // requested catalog id matches no advertised option — never continue on
      // a different model than the Recipe selected.
      return createAcpStructuredSession(command, {
        ...input,
        strictModelResolution: true,
      });
    },
    async buildAcpAuthCommand(ctx?: AgentEnvContext) {
      const location = detectProbeLocation(ctx);
      return buildDeepSeekCommand(
        location,
        [...DEEPSEEK_ACP_ARGS],
        resolveAgentBinaryPath(location, "dsh"),
      );
    },
  };
}
