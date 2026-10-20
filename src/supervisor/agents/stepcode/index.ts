import type { PromptSegment } from "@/shared/contracts";
import { inlinePromptSegmentText } from "@/shared/promptContent";
import { detectAgentInstall, type AgentAdapter } from "../base";
import { buildPiArgs, buildPiOneShotArgs } from "../pi/argv";
import { PiRpcSession } from "../pi/rpcSession";
import { detectPiTerminalStatus } from "../pi/terminal";
import { stepCodeDefaultCapabilities, stepCodeDetectionSpec } from "./detection";
import {
  discoverStepCodeSessionRef,
  snapshotStepCodePreSpawnSessions,
  watchStepCodeSessionRef,
} from "./sessionFiles";

/**
 * Step Code's `--approve` only trusts project-local files; tool approval is
 * gated by its own `--approval-mode` (confirm | auto). The declared bypass id
 * is `never` (see stepCodeDefaultCapabilities), so map the resolved thread
 * policy onto the CLI flag explicitly — supervised stays `confirm` even when
 * the CLI-side settings default to auto.
 */
export function stepCodeApprovalModeArgs(approvalPolicy: string | undefined): string[] {
  return ["--approval-mode", approvalPolicy === "never" ? "auto" : "confirm"];
}

/**
 * Step Code (StepFun's official `step` CLI) is a pi-family agent: it keeps the
 * pi JSONL RPC wire (`step --mode rpc`), the pi session-file layout under
 * `~/.stepcode/agent/sessions`, and the pi extension API (`registerTool` /
 * `registerProvider`). The adapter therefore reuses the pi runtime pieces and
 * only owns Step-specific paths, labels and capability probing.
 */
export function createStepCodeAdapter(): AgentAdapter {
  let capabilities = stepCodeDefaultCapabilities;

  return {
    kind: stepCodeDetectionSpec.kind,
    label: stepCodeDetectionSpec.label,
    binary: stepCodeDetectionSpec.binary,
    ...(stepCodeDetectionSpec.update ? { update: stepCodeDetectionSpec.update } : {}),
    skillSupport: {
      roots: [
        {
          id: "stepcode",
          label: stepCodeDetectionSpec.label,
          globalPath: ".stepcode/agent/skills",
          projectPath: ".stepcode/skills",
          globalOverride: { env: "STEP_CODING_AGENT_DIR", path: "skills" },
        },
        {
          id: "agents",
          label: "Shared agent skills",
          globalPath: ".agents/skills",
          projectPath: ".agents/skills",
        },
      ],
      invocation: "skill",
      precedence: {
        global: ["stepcode", "agents"],
        project: ["stepcode", "agents"],
      },
    },
    get capabilities() {
      return capabilities;
    },

    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, stepCodeDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(location, config, prompt) {
      void snapshotStepCodePreSpawnSessions(location);
      return {
        binary: "step",
        args: buildPiArgs(
          config,
          prompt,
          undefined,
          stepCodeApprovalModeArgs(config.approvalPolicy),
        ),
      };
    },

    buildResumeArgv(_location, config, prompt, sessionRef) {
      return {
        binary: "step",
        args: buildPiArgs(
          config,
          prompt,
          sessionRef.providerSessionId,
          stepCodeApprovalModeArgs(config.approvalPolicy),
        ),
      };
    },

    async createStructuredSession(input) {
      if (input.presentationMode !== "gui") return undefined;
      return PiRpcSession.create(input, {
        binary: "step",
        defaultBinary: "step",
        label: "Step Code",
        extraArgs: stepCodeApprovalModeArgs(input.config.approvalPolicy),
      });
    },

    createInitialSessionRef() {
      return undefined;
    },
    initialSessionRefDiscoveryDelayMs: 1_000,
    discoverSessionRef: discoverStepCodeSessionRef,
    watchSessionRef: watchStepCodeSessionRef,

    buildDirectInput(prompt) {
      return [prompt, "@wait:150", "\r"];
    },

    formatPromptSegments(segments: PromptSegment[]) {
      const attachments = segments.filter((segment) => segment.kind === "attachment");
      const content = segments
        .filter((segment) => segment.kind !== "attachment")
        .map(inlinePromptSegmentText)
        .join("");
      const paths = attachments.map((segment) => `@${segment.path}`).join(" ");
      return paths ? `${content}\n\n${paths}` : content;
    },

    isReadyForInitialPrompt(text) {
      return /ask\s+step\s+to\s+do\s+anything|\/\s+for\s+commands/i.test(text);
    },
    detectTerminalStatus: detectPiTerminalStatus,

    buildOneShotCommand(model, effort, prompt) {
      if (!prompt) return undefined;
      return {
        command: "step",
        args: buildPiOneShotArgs({ model, ...(effort ? { effort } : {}) }, prompt, {
          textOnly: true,
        }),
        stdin: "",
      };
    },

    buildTextOnlyOneShotCommand(model, effort, prompt) {
      if (!prompt) return undefined;
      return {
        command: "step",
        args: buildPiOneShotArgs({ model, ...(effort ? { effort } : {}) }, prompt, {
          textOnly: true,
        }),
        stdin: "",
      };
    },

    buildSubagentOneShotCommand(input) {
      return {
        command: "step",
        args: buildPiOneShotArgs(
          { model: input.model, ...(input.effort ? { effort: input.effort } : {}) },
          input.prompt,
        ),
        stdin: "",
      };
    },
  };
}

export { stepCodeDefaultCapabilities, stepCodeDetectionSpec } from "./detection";
