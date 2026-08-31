import type {
  NativeHarnessCapability,
  NativeHarnessCapabilityState,
  NativeHarnessDescriptor,
} from "@/shared/crafting";

function capabilityMap(
  implemented: readonly NativeHarnessCapability[],
  unsupported: readonly NativeHarnessCapability[] = [],
): Record<string, NativeHarnessCapabilityState> {
  const result: Record<string, NativeHarnessCapabilityState> = {};
  // The adapter seam and fixture tests prove wiring only. A capability may be
  // advertised as integrated after a real provider-native handshake/session
  // has been captured; until then keep the production matrix honest.
  for (const capability of implemented) result[capability] = "implementation missing";
  for (const capability of unsupported) result[capability] = "native unsupported";
  return result;
}

const COMMON_STRUCTURED_CAPABILITIES = [
  "discovery",
  "auth",
  "profile",
  "start",
  "resume",
  "multi_turn",
  "streaming",
  "events",
  "tool_execution",
  "file_access",
  "shell_execution",
  "permission",
  "skills",
  "interrupt",
  "cleanup",
  "diagnostics",
] as const satisfies readonly NativeHarnessCapability[];

export const CODEX_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:codex",
  harnessKind: "codex",
  label: "Codex Native Harness",
  vendor: "openai",
  official: true,
  transport: "codex-app-server-json-rpc",
  machineFacingBoundary: "codex app-server --stdio",
  capabilities: capabilityMap([
    ...COMMON_STRUCTURED_CAPABILITIES,
    "mcp",
    "subagents",
    "context",
    "compaction",
  ]),
};

export const GROK_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:grok",
  harnessKind: "grok",
  label: "Grok Build Native Harness",
  vendor: "xai",
  official: true,
  transport: "acp-stdio",
  machineFacingBoundary: "grok agent stdio (ACP)",
  capabilities: capabilityMap(
    [...COMMON_STRUCTURED_CAPABILITIES, "mcp", "subagents"],
    ["context", "compaction"],
  ),
};

export const KIMI_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:kimi",
  harnessKind: "kimi",
  label: "Kimi Code Native Harness",
  vendor: "moonshot",
  official: true,
  transport: "acp-stdio",
  machineFacingBoundary: "kimi acp",
  capabilities: capabilityMap(
    [...COMMON_STRUCTURED_CAPABILITIES, "subagents"],
    ["mcp", "context", "compaction"],
  ),
};

export const ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:antigravity",
  harnessKind: "antigravity",
  label: "Antigravity Native Harness",
  vendor: "google",
  official: true,
  transport: "official-pty",
  machineFacingBoundary: "agy interactive PTY",
  capabilities: capabilityMap(
    [
      "discovery",
      "auth",
      "profile",
      "start",
      "resume",
      "multi_turn",
      "streaming",
      "events",
      "tool_execution",
      "file_access",
      "shell_execution",
      "permission",
      "skills",
      "interrupt",
      "cleanup",
      "diagnostics",
    ],
    ["mcp", "subagents", "context", "compaction"],
  ),
};

export const DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:deepseek",
  harnessKind: "deepseek",
  label: "DeepSeek / DSH Native Harness",
  vendor: "deepseek",
  official: true,
  transport: "unavailable",
  machineFacingBoundary: "dsh native runtime (not installed)",
  capabilities: Object.fromEntries(
    [
      "discovery",
      "auth",
      "profile",
      "start",
      "resume",
      "multi_turn",
      "streaming",
      "events",
      "tool_execution",
      "file_access",
      "shell_execution",
      "permission",
      "mcp",
      "skills",
      "subagents",
      "context",
      "compaction",
      "interrupt",
      "cleanup",
      "diagnostics",
    ].map((capability) => [capability, "unavailable"]),
  ),
};

export const OPENCODE_NATIVE_HARNESS_DESCRIPTOR: NativeHarnessDescriptor = {
  id: "native-harness:opencode",
  harnessKind: "opencode",
  label: "OpenCode Native Harness",
  vendor: "opencode",
  official: true,
  transport: "official-http-sse",
  machineFacingBoundary: "opencode serve (HTTP/OpenAPI + SSE)",
  capabilities: {
    ...capabilityMap([
      "auth",
      "profile",
      "multi_turn",
      "streaming",
      "tool_execution",
      "file_access",
      "shell_execution",
      "permission",
      "mcp",
      "skills",
      "context",
      "compaction",
    ]),
    // Verified against the official v1.18.25 headless carrier. Provider/model
    // assistant readiness remains a separate fail-closed route gate.
    discovery: "supported+integrated",
    start: "supported+integrated",
    resume: "supported+integrated",
    events: "supported+integrated",
    interrupt: "supported+integrated",
    cleanup: "supported+integrated",
    diagnostics: "supported+integrated",
  },
};

export const NATIVE_HARNESS_DESCRIPTORS = {
  codex: CODEX_NATIVE_HARNESS_DESCRIPTOR,
  grok: GROK_NATIVE_HARNESS_DESCRIPTOR,
  kimi: KIMI_NATIVE_HARNESS_DESCRIPTOR,
  antigravity: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  deepseek: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  opencode: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
} as const;
