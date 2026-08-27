import type { AccountBinding, ProjectLocation } from "@/shared/contracts";
import type { HarnessRuntimeAdapter } from "@/shared/crafting";
import { createAntigravityAdapter } from "@/supervisor/agents/antigravity";
import { createGrokAdapter } from "@/supervisor/agents/grok";
import { createKimiAdapter } from "@/supervisor/agents/kimi";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
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

export {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  NATIVE_HARNESS_DESCRIPTORS,
  PtyNativeHarnessRuntimeAdapter,
  StructuredNativeHarnessRuntimeAdapter,
  UnavailableNativeHarnessRuntimeAdapter,
};
export type {
  PtyNativeHarnessRuntimeAdapterOptions,
  StructuredNativeHarnessRuntimeAdapterOptions,
};

export interface NativeHarnessAdapterFactoryOptions {
  projectLocation: ProjectLocation;
  accountBinding?: AccountBinding;
  profileRef?: string;
  /** Base process env for the spawned runtime (e.g. managed GROK_HOME). */
  baseSpawnEnv?: Record<string, string>;
  onPromptError?: (error: unknown) => void | Promise<void>;
}

type NativeHarnessFactory = (
  options: NativeHarnessAdapterFactoryOptions,
) => HarnessRuntimeAdapter;

const FACTORIES: Partial<Record<string, NativeHarnessFactory>> = {
  grok: ({ projectLocation, accountBinding, profileRef, baseSpawnEnv, onPromptError }) =>
    new StructuredNativeHarnessRuntimeAdapter({
      adapter: withGrokBaseSpawnEnv(createGrokAdapter(), baseSpawnEnv),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
      ...(onPromptError ? { onPromptError } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
  kimi: ({ projectLocation, accountBinding, profileRef }) =>
    new StructuredNativeHarnessRuntimeAdapter({
      adapter: createKimiAdapter(),
      descriptor: KIMI_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
    } satisfies StructuredNativeHarnessRuntimeAdapterOptions),
  antigravity: ({ projectLocation, accountBinding, profileRef }) =>
    new PtyNativeHarnessRuntimeAdapter({
      adapter: createAntigravityAdapter(),
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation,
      ...(accountBinding ? { accountBinding } : {}),
      ...(profileRef ? { profileRef } : {}),
    } satisfies PtyNativeHarnessRuntimeAdapterOptions),
  deepseek: () =>
    new UnavailableNativeHarnessRuntimeAdapter(
      DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      "The official DeepSeek / DSH executable was not discovered during the v0.4 audit.",
    ),
};

function withGrokBaseSpawnEnv<T extends { baseSpawnEnv?: Record<string, string> }>(
  adapter: T,
  baseSpawnEnv: Record<string, string> | undefined,
): T {
  return baseSpawnEnv
    ? { ...adapter, baseSpawnEnv: { ...adapter.baseSpawnEnv, ...baseSpawnEnv } }
    : adapter;
}

export function createNativeHarnessRuntimeAdapter(
  harnessKind: string,
  options: NativeHarnessAdapterFactoryOptions,
): HarnessRuntimeAdapter | undefined {
  return FACTORIES[harnessKind]?.(options);
}

export function getNativeHarnessDescriptor(harnessKind: string) {
  return NATIVE_HARNESS_DESCRIPTORS[harnessKind as keyof typeof NATIVE_HARNESS_DESCRIPTORS];
}

export { CODEX_NATIVE_HARNESS_DESCRIPTOR as codexNativeHarnessDescriptor };
