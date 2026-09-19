import { join } from "node:path";
import type { CraftPlan, HarnessRuntimeAdapter, NativeHarnessDescriptor } from "@/shared/crafting";
import type { ProjectLocation, ResolvedMcpServer, PromptSegment } from "@/shared/contracts";
import type { AgentAdapter } from "@/supervisor/agents/base";
import { buildMuseForeignChildEnv } from "@/supervisor/agents/muse/foreignEndpoint";
import { NativeCodexRuntimeAdapter } from "../nativeCodex/nativeCodexRuntimeAdapter";
import { StructuredNativeHarnessRuntimeAdapter } from "../nativeHarness/structuredAdapter";
import {
  prepareCodexEndpointRuntime,
  prepareKimiEndpointRuntime,
  vendorEndpointEnv,
} from "../compatibleEndpointRuntime";
import { writeOpenCodeConfigFile, type TargetHarnessConfig } from "./exporters";
import { CraftingError } from "@/shared/crafting/errors";

/** Endpoint 只改变模型接入；会话、MCP、权限、恢复与中断仍由目标 Harness 管理。 */
export function createCompatibilityTargetRuntime(input: {
  config: TargetHarnessConfig;
  plan: CraftPlan;
  directory: string;
  projectLocation: ProjectLocation;
  agent: AgentAdapter | undefined;
  descriptor: NativeHarnessDescriptor | undefined;
  mcpServers: readonly ResolvedMcpServer[];
  skillSegments: readonly PromptSegment[];
  inlineSkillInstructions?: string;
}): HarnessRuntimeAdapter {
  const { config, plan, directory } = input;
  const capabilities = {
    mcpServers: input.mcpServers,
    skillSegments: input.skillSegments,
    ...(input.inlineSkillInstructions
      ? { inlineSkillInstructions: input.inlineSkillInstructions }
      : {}),
  };
  if (config.harnessKind === "codex") {
    const profile = prepareCodexEndpointRuntime({
      directory,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      name: "CraftStation CPA",
    });
    return new NativeCodexRuntimeAdapter({
      baseSpawnEnv: profile.env,
      codexHome: profile.codexHome,
      profileMode: "endpoint",
      ...capabilities,
    });
  }
  if (!input.agent?.createStructuredSession || !input.descriptor) {
    throw CraftingError.runtimeUnavailable(
      config.harnessKind,
      "目标 Harness 没有可用的 structured 会话接口。",
    );
  }
  let env = config.customEnv;
  let model = config.model;
  if (config.harnessKind === "opencode") {
    const configPath = writeOpenCodeConfigFile(config, directory);
    env = {
      OPENCODE_CONFIG: configPath,
      OPENCODE_CONFIG_DIR: directory,
      CRAFTSTATION_OPENCODE_PROVIDER: "craftstation-compat",
    };
    model = `craftstation-compat/${model}`;
  } else if (config.harnessKind === "muse") {
    env = buildMuseForeignChildEnv({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      isolationDir: directory,
      model,
    });
  } else if (config.harnessKind === "kimi") {
    env = prepareKimiEndpointRuntime({
      directory: join(directory, "kimi"),
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model,
      protocol: "responses",
    }).env;
  } else if (config.harnessKind === "grok" || config.harnessKind === "deepseek") {
    env = vendorEndpointEnv(config.harnessKind, config.baseUrl, config.apiKey);
    if (config.harnessKind === "grok") env.GROK_HOME = join(directory, "grok");
  }
  const target = new StructuredNativeHarnessRuntimeAdapter({
    adapter: { ...input.agent, baseSpawnEnv: { ...input.agent.baseSpawnEnv, ...env } },
    descriptor: input.descriptor,
    projectLocation: input.projectLocation,
    ...capabilities,
  });
  // OpenCode 的 provider/model 是 transport 身份；公开配方仍保留原模型与来源。
  return {
    id: target.id,
    harnessKind: target.harnessKind,
    supports: (candidate) => target.supports(candidate),
    spawnEntity: (candidate) =>
      target.spawnEntity({
        ...candidate,
        overrides: { ...plan.overrides, model },
      }),
    createSession: (entity) => target.createSession(entity),
    resumeSession: (entity, sessionRef) => target.resumeSession(entity, sessionRef),
    getDiagnostics: () => target.getDiagnostics(),
    dispose: () => target.dispose(),
  };
}
