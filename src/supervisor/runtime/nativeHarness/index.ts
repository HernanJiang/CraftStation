import type { AccountBinding, ProjectLocation, PromptSegment } from "@/shared/contracts";
import type { HarnessRuntimeAdapter } from "@/shared/crafting";
import { createGrokAdapter } from "@/supervisor/agents/grok";
import { createKimiAdapter } from "@/supervisor/agents/kimi";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_API_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
  NATIVE_HARNESS_DESCRIPTORS,
} from "./descriptors";
import {
  PtyNativeHarnessRuntimeAdapter,
  type PtyNativeHarnessRuntimeAdapterOptions,
} from "./ptyAdapter";
import {
  StructuredNativeHarnessRuntimeAdapter,
  type StructuredNativeHarnessRuntimeAdapterOptions,
} from "./structuredAdapter";
import { UnavailableNativeHarnessRuntimeAdapter } from "./unavailableAdapter";
import { NativeProcessHarnessRuntimeAdapter } from "./nativeAdapter";
import { DeepSeekApiRuntimeAdapter } from "./deepSeekApiAdapter";
import { resolveExecutablePath } from "@/supervisor/agents/base";
import { OpenCodeNativeRuntimeAdapter } from "../openCodeNative/adapter";
import type { OpenCodeExecutableReadinessProvider } from "@/shared/opencodeNative";
import type { OpenCodeRuntimeBindingResolver } from "../openCodeNative/runtimeBinding";
import type { OpenCodeNativeServerPool } from "../openCodeNative/serverPool";

export {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_API_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
  NATIVE_HARNESS_DESCRIPTORS,
  PtyNativeHarnessRuntimeAdapter,
  StructuredNativeHarnessRuntimeAdapter,
  UnavailableNativeHarnessRuntimeAdapter,
  NativeProcessHarnessRuntimeAdapter,
};
export type { PtyNativeHarnessRuntimeAdapterOptions, StructuredNativeHarnessRuntimeAdapterOptions };

export interface NativeHarnessAdapterFactoryOptions {
  projectLocation: ProjectLocation;
  accountBinding?: AccountBinding;
  profileRef?: string;
  /** Base process env for the spawned runtime (e.g. managed GROK_HOME). */
  baseSpawnEnv?: Record<string, string>;
  /** Supervisor-resolved MCP descriptors; provider adapters never resolve ids themselves. */
  mcpServers?: readonly import("@/shared/contracts").ResolvedMcpServer[];
  onPromptError?: (error: unknown) => void | Promise<void>;
  /** Optional injectable executable resolver for testing discovery/readiness boundaries. */
  resolveExecutable?: (command: string) => string | undefined;
  /** Optional custom spawn process for testing child process lifecycle boundaries. */
  spawnProcess?: typeof import("node:child_process").spawn;
  /** Plan-scoped non-secret API runtime options such as base URL and key env name. */
  runtimeOptions?: Record<string, unknown>;
  /** Supervisor-validated CraftPlan skills. */
  skillSegments?: readonly PromptSegment[];
  inlineSkillInstructions?: string;
  openCodeReadinessProvider?: OpenCodeExecutableReadinessProvider;
  openCodeRuntimeBindingResolver?: OpenCodeRuntimeBindingResolver;
  openCodeServerPool?: OpenCodeNativeServerPool;
}

type NativeHarnessFactory = (options: NativeHarnessAdapterFactoryOptions) => HarnessRuntimeAdapter;

function withBaseSpawnEnv<T extends { baseSpawnEnv?: Record<string, string> }>(
  adapter: T,
  baseSpawnEnv: Record<string, string> | undefined,
): T {
  return baseSpawnEnv
    ? { ...adapter, baseSpawnEnv: { ...adapter.baseSpawnEnv, ...baseSpawnEnv } }
    : adapter;
}

const FACTORIES: Partial<Record<string, NativeHarnessFactory>> = {
  grok: ({
    projectLocation,
    accountBinding,
    profileRef,
    baseSpawnEnv,
    mcpServers,
    onPromptError,
    skillSegments,
    inlineSkillInstructions,
  }) =>
    new StructuredNativeHarnessRuntimeAdapter({
      adapter: withBaseSpawnEnv(createGrokAdapter(), baseSpawnEnv),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(onPromptError ? { onPromptError } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
  kimi: ({
    projectLocation,
    accountBinding,
    profileRef,
    baseSpawnEnv,
    mcpServers,
    skillSegments,
    inlineSkillInstructions,
  }) =>
    new StructuredNativeHarnessRuntimeAdapter({
      adapter: withBaseSpawnEnv(createKimiAdapter(), baseSpawnEnv),
      descriptor: KIMI_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
  antigravity: ({
    projectLocation,
    profileRef,
    mcpServers,
    resolveExecutable = resolveExecutablePath,
    spawnProcess,
    skillSegments,
    inlineSkillInstructions,
  }) => {
    const executable = resolveExecutable("agy");
    if (!executable) {
      return new UnavailableNativeHarnessRuntimeAdapter(
        ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
        "The official Antigravity CLI ('agy') is not installed on this machine.",
      );
    }
    return new NativeProcessHarnessRuntimeAdapter({
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      mode: "antigravity",
      runtimeCommand: executable,
      ...(profileRef ? { profileRef } : {}),
      ...(spawnProcess ? { spawnProcess } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    });
  },
  deepseek: ({
    projectLocation,
    profileRef,
    resolveExecutable = resolveExecutablePath,
    spawnProcess,
    skillSegments,
    inlineSkillInstructions,
  }) => {
    // Official DeepSeek Harness stdio JSON-RPC agent binary lookup.
    // Supports official 'dsh-jsonrpc-agent' and 'dsh' machine carriers.
    const executable = resolveExecutable("dsh-jsonrpc-agent") ?? resolveExecutable("dsh");
    if (!executable) {
      return new UnavailableNativeHarnessRuntimeAdapter(
        DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        "The official DeepSeek Harness SDK runtime ('dsh-jsonrpc-agent') is not installed on this machine.",
      );
    }
    return new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      mode: "deepseek",
      runtimeCommand: executable,
      ...(profileRef ? { profileRef } : {}),
      ...(spawnProcess ? { spawnProcess } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    });
  },
  "deepseek-api": ({ projectLocation, runtimeOptions, mcpServers, inlineSkillInstructions }) =>
    new DeepSeekApiRuntimeAdapter({
      descriptor: DEEPSEEK_API_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(runtimeOptions ? { runtimeOptions } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    }),
  opencode: ({
    projectLocation,
    accountBinding,
    profileRef,
    openCodeReadinessProvider,
    openCodeRuntimeBindingResolver,
    openCodeServerPool,
  }) =>
    new OpenCodeNativeRuntimeAdapter({
      projectLocation,
      descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(openCodeReadinessProvider ? { readinessProvider: openCodeReadinessProvider } : {}),
      ...(openCodeRuntimeBindingResolver
        ? { runtimeBindingResolver: openCodeRuntimeBindingResolver }
        : {}),
      ...(openCodeServerPool ? { serverPool: openCodeServerPool } : {}),
    }),
};

export function createNativeHarnessRuntimeAdapter(
  harnessKind: string,
  options: NativeHarnessAdapterFactoryOptions,
): HarnessRuntimeAdapter | undefined {
  const factory = FACTORIES[harnessKind];
  return factory ? factory(options) : undefined;
}
