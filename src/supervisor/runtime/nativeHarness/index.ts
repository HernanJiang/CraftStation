import type { AccountBinding, ProjectLocation, PromptSegment } from "@/shared/contracts";
import type { HarnessRuntimeAdapter } from "@/shared/crafting";
import { createDevinAdapter } from "@/supervisor/agents/devin";
import { createGrokAdapter } from "@/supervisor/agents/grok";
import { createKimiAdapter } from "@/supervisor/agents/kimi";
import { createMuseAdapter } from "@/supervisor/agents/muse";
import {
  ANTIGRAVITY_DISABLE_AUTO_UPDATE_ENV,
  antigravitySessionEnvForLocation,
} from "@/supervisor/agents/antigravity/detection";
import { agentProxySpawnEnv } from "@/supervisor/agents/base/proxyEnv";
import { mergeSpawnEnv } from "@/supervisor/agents/base/spawnEnv";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_API_HARNESS_DESCRIPTOR,
  DEVIN_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  MUSE_NATIVE_HARNESS_DESCRIPTOR,
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
  DEVIN_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  MUSE_NATIVE_HARNESS_DESCRIPTOR,
  OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
  NATIVE_HARNESS_DESCRIPTORS,
  PtyNativeHarnessRuntimeAdapter,
  StructuredNativeHarnessRuntimeAdapter,
  UnavailableNativeHarnessRuntimeAdapter,
  NativeProcessHarnessRuntimeAdapter,
};
export {
  DEEPSEEK_ACP_UPSTREAM,
  DEEPSEEK_ACP_UPSTREAM_LIMITS,
  DEEPSEEK_EXECUTABLE_CANDIDATES,
  DEEPSEEK_HARNESS_KINDS,
  DEEPSEEK_PROFILE_NAMES,
  DEEPSEEK_SDK_CLIENT_PACKAGE,
  DEEPSEEK_TRANSPORT_PREFERENCE,
  buildDeepSeekProfileArgs,
  getDeepSeekCapabilitySummary,
  isDeepSeekNativeHarnessKind,
  normalizeDeepSeekProfileName,
  resolveDeepSeekTransport,
  type DeepSeekCapabilitySummary,
  type DeepSeekHarnessKind,
  type DeepSeekProfileName,
  type DeepSeekTransportKind,
} from "./deepseekCapabilityProfile";
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
    baseSpawnEnv,
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
    // Pool-account scope redirects (AGY_ADC_AUTH + GOOGLE_APPLICATION_
    // CREDENTIALS) ride the adapter-level runtime env onto every spawn; the
    // WSL boundary strips them — a distro agy cannot read a host credential.
    // The auto-update kill switch and the shared proxy layer are laid down
    // FIRST so a bound account env can never displace them: the bg-updater
    // escapes any pseudoconsole and pops a stray terminal window, and this
    // lane used to spawn without the switch entirely (B-mode binds no account
    // env for antigravity, so baseSpawnEnv arrives undefined here).
    const runtimeEnv = antigravitySessionEnvForLocation(
      mergeSpawnEnv(agentProxySpawnEnv(), ANTIGRAVITY_DISABLE_AUTO_UPDATE_ENV, baseSpawnEnv),
      projectLocation,
    );
    return new NativeProcessHarnessRuntimeAdapter({
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      mode: "antigravity",
      runtimeCommand: executable,
      ...(runtimeEnv ? { runtimeEnv } : {}),
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
    // Official DeepSeek Harness carrier lookup. Launch preference (see
    // deepseekCapabilityProfile.ts): the `dsh` CLI serves both the `sdk`
    // profile (owned runs — same launch spec as the official TypeScript SDK
    // `@deepseek-ai/dsh-sdk-client`: `dsh --profile sdk [--patch ...]`) and
    // the ready-to-use `acp` automation profile (`dsh --profile acp`);
    // `dsh-jsonrpc-agent` remains as the legacy raw-JSON-RPC carrier.
    // User-configured executablePath (plan.runtimeBinding.options) wins inside
    // NativeProcessHarnessRuntimeAdapter; PATH discovery here is only the
    // default.
    const executable = resolveExecutable("dsh-jsonrpc-agent") ?? resolveExecutable("dsh");
    if (!executable) {
      return new UnavailableNativeHarnessRuntimeAdapter(
        DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
        "Not installed / executable not found: the official DeepSeek Harness runtime ('dsh-jsonrpc-agent' or 'dsh' on PATH) is not installed on this machine — install it, or use the '@deepseek-ai/dsh-sdk-client' launch spec (`dsh --profile sdk`) or the automation profile `dsh --profile acp`.",
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
  // Alias for the DeepSeek Harness first-class id requested by callers that
  // use the fully-qualified `deepseek-harness` name. Same runtime, same
  // descriptor identity (`harnessKind: deepseek`) — never a parallel runtime.
  "deepseek-harness": (options) => {
    const factory = FACTORIES.deepseek;
    if (!factory) {
      throw new Error("DeepSeek native harness factory is not registered.");
    }
    return factory(options);
  },
  "deepseek-api": ({ projectLocation, runtimeOptions, mcpServers, inlineSkillInstructions }) =>
    new DeepSeekApiRuntimeAdapter({
      descriptor: DEEPSEEK_API_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(runtimeOptions ? { runtimeOptions } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    }),
  muse: ({
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
      adapter: withBaseSpawnEnv(createMuseAdapter(), baseSpawnEnv),
      descriptor: MUSE_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(onPromptError ? { onPromptError } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
  devin: ({
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
      adapter: withBaseSpawnEnv(createDevinAdapter(), baseSpawnEnv),
      descriptor: DEVIN_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(mcpServers !== undefined ? { mcpServers } : {}),
      ...(onPromptError ? { onPromptError } : {}),
      ...(skillSegments ? { skillSegments } : {}),
      ...(inlineSkillInstructions ? { inlineSkillInstructions } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
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
