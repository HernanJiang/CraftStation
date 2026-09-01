import { codexContextWindowOverrides } from "@/shared/agents/codexContextWindows";
import type { ProjectLocation, ResolvedMcpServer, ThreadConfig } from "@/shared/contracts";
import { resolveThreadWorkspace } from "@/shared/homeScope";
import { buildCodexMcp } from "../userMcp";
import type { CodexClientRequestMap } from "./protocol";

type ThreadForkParams = CodexClientRequestMap["thread/fork"]["params"];
type ThreadConfigOverrides = Pick<
  ThreadForkParams,
  "model" | "cwd" | "approvalPolicy" | "approvalsReviewer" | "sandbox" | "config"
>;

export function buildCodexThreadOverrides(
  config: ThreadConfig,
  options?: {
    projectLocation?: ProjectLocation;
    mcpServers?: readonly ResolvedMcpServer[];
    /** CraftStation thread id; home-scope threads derive their isolated cwd from it. */
    threadId?: string;
  },
): ThreadConfigOverrides {
  const mcpConfig = options?.mcpServers ? buildCodexMcp(options.mcpServers).config : {};
  const cwd =
    options?.projectLocation && options.threadId
      ? resolveThreadWorkspace(options.projectLocation, options.threadId)
      : options?.projectLocation
        ? options.projectLocation.kind === "wsl"
          ? options.projectLocation.linuxPath
          : options.projectLocation.path
        : undefined;
  return {
    model: config.model,
    ...(cwd ? { cwd } : {}),
    ...(config.approvalPolicy
      ? {
          approvalPolicy: config.approvalPolicy as NonNullable<ThreadForkParams["approvalPolicy"]>,
        }
      : {}),
    ...(config.approvalsReviewer
      ? {
          approvalsReviewer: config.approvalsReviewer as NonNullable<
            ThreadForkParams["approvalsReviewer"]
          >,
        }
      : {}),
    ...(config.sandboxMode
      ? { sandbox: config.sandboxMode as NonNullable<ThreadForkParams["sandbox"]> }
      : {}),
    config: {
      ...(config.effort ? { model_reasoning_effort: config.effort } : {}),
      model_reasoning_summary: "auto",
      ...codexContextWindowOverrides(config.contextSize),
      ...mcpConfig,
    },
  };
}
