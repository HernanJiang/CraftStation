import type {
  AgentCapability,
  AgentRuntimeVariant,
  AgentStatus,
  AuthState,
  SessionRef,
  ThreadConfig,
  ThreadPresentationMode,
} from "./contracts";

export interface AgentModelSelection {
  reasoning: {
    values: string[];
    default?: string;
  };
  fast: {
    supported: boolean;
    available: boolean;
    disabledReason?: string;
  };
}

export function authStateForPresentation(
  status: Pick<AgentStatus, "authState" | "presentationAuthStates">,
  presentationMode: ThreadPresentationMode,
): AuthState {
  return status.presentationAuthStates?.[presentationMode] ?? status.authState;
}

export function authStatusForPresentation(
  status: AgentStatus,
  presentationMode: ThreadPresentationMode,
): AgentStatus {
  const authState = authStateForPresentation(status, presentationMode);
  if (status.presentationAuthUsesProviderLogin?.[presentationMode] !== false) {
    return authState === status.authState ? status : { ...status, authState };
  }
  return stripProviderLogin({ ...status, authState });
}

function stripProviderLogin(status: AgentStatus): AgentStatus {
  const {
    loginCommand: _loginCommand,
    authMethods: _authMethods,
    authLogoutSupported: _authLogoutSupported,
    preferTerminalLogin: _preferTerminalLogin,
    ...withoutProviderLogin
  } = status;
  return withoutProviderLogin;
}

function restoreProviderLogin(source: AgentStatus, status: AgentStatus): AgentStatus {
  return {
    ...status,
    ...(source.loginCommand !== undefined ? { loginCommand: source.loginCommand } : {}),
    ...(source.authMethods !== undefined ? { authMethods: source.authMethods } : {}),
    ...(source.authLogoutSupported !== undefined
      ? { authLogoutSupported: source.authLogoutSupported }
      : {}),
    ...(source.preferTerminalLogin !== undefined
      ? { preferTerminalLogin: source.preferTerminalLogin }
      : {}),
  };
}

function compatibleContextMetadata(
  capabilities: AgentCapability,
  override: NonNullable<
    NonNullable<AgentCapability["presentationCapabilities"]>[ThreadPresentationMode]
  >,
): Pick<AgentCapability, "contextSizes" | "modelContextSizes" | "defaultContextSize"> {
  const overrideModelIds = override?.models?.map((model) => model.id) ?? [];
  if (overrideModelIds.length === 0) return {};

  const rootModelIds = new Set(capabilities.models.map((model) => model.id));
  if (!overrideModelIds.every((modelId) => rootModelIds.has(modelId))) return {};
  const compatibleModelIds = overrideModelIds;

  const rootModelContextSizes = capabilities.modelContextSizes;
  const compatibleModelContextSizes = rootModelContextSizes
    ? Object.fromEntries(
        compatibleModelIds.flatMap((modelId) => {
          const contextIds = rootModelContextSizes[modelId];
          return contextIds ? [[modelId, contextIds]] : [];
        }),
      )
    : undefined;
  const compatibleContextIds = new Set(Object.values(compatibleModelContextSizes ?? {}).flat());
  const contextSizes = capabilities.contextSizes?.filter(
    (size) => !rootModelContextSizes || compatibleContextIds.has(size.id),
  );
  const defaultContextSize =
    capabilities.defaultContextSize &&
    (!rootModelContextSizes || compatibleContextIds.has(capabilities.defaultContextSize))
      ? capabilities.defaultContextSize
      : undefined;

  return {
    ...(override.contextSizes === undefined && contextSizes && contextSizes.length > 0
      ? { contextSizes }
      : {}),
    ...(override.modelContextSizes === undefined &&
    compatibleModelContextSizes &&
    Object.keys(compatibleModelContextSizes).length > 0
      ? { modelContextSizes: compatibleModelContextSizes }
      : {}),
    ...(override.defaultContextSize === undefined && defaultContextSize
      ? { defaultContextSize }
      : {}),
  };
}

export function capabilitiesForPresentation(
  capabilities: AgentCapability,
  presentationMode: ThreadPresentationMode,
): AgentCapability {
  const override = capabilities.presentationCapabilities?.[presentationMode];
  if (!override) return capabilities;

  const {
    defaultEffort: _defaultEffort,
    modelDefaultEfforts: _modelDefaultEfforts,
    defaultHiddenModels: _defaultHiddenModels,
    contextSizes: _contextSizes,
    modelContextSizes: _modelContextSizes,
    defaultContextSize: _defaultContextSize,
    fastModels: _fastModels,
    thinkingModels: _thinkingModels,
    subProviders: _subProviders,
    modelSubProvider: _modelSubProvider,
    ...rest
  } = capabilities;

  return {
    ...rest,
    ...override,
    models: override.models ?? [],
    efforts: override.efforts ?? [],
    modelEfforts: override.modelEfforts ?? {},
    modes: override.modes ?? capabilities.modes,
    approvalPolicies: override.approvalPolicies ?? capabilities.approvalPolicies,
    sandboxModes: override.sandboxModes ?? capabilities.sandboxModes,
    supportsResume: override.supportsResume ?? capabilities.supportsResume,
    supportsDirectInput: override.supportsDirectInput ?? capabilities.supportsDirectInput,
    liveInputMode: override.liveInputMode ?? capabilities.liveInputMode,
    presentationMode: override.presentationMode ?? capabilities.presentationMode,
    settingDefs: override.settingDefs ?? capabilities.settingDefs,
    ...compatibleContextMetadata(capabilities, override),
    presentationCapabilities: capabilities.presentationCapabilities,
  };
}

/**
 * Resolve every presentation-scoped part of an agent status together.
 *
 * Consumers should derive this once for the active thread/draft and pass the
 * returned status through the rest of the flow. That keeps authentication,
 * models, slash commands, input behavior, and safety defaults on the same
 * runtime surface.
 */
export function agentStatusForPresentation(
  status: AgentStatus,
  presentationMode: ThreadPresentationMode,
  sessionRef?: SessionRef,
): AgentStatus {
  const presentationStatus = {
    ...authStatusForPresentation(status, presentationMode),
    capabilities: capabilitiesForPresentation(status.capabilities, presentationMode),
  };
  const runtimeVariant = runtimeVariantForSession(status, presentationMode, sessionRef);
  if (!runtimeVariant) {
    return presentationStatus;
  }

  const runtimeStatus: AgentStatus = {
    ...presentationStatus,
    installed: runtimeVariant.installed,
    authState: runtimeVariant.authState,
    presentationAuthStates: {
      ...presentationStatus.presentationAuthStates,
      [presentationMode]: runtimeVariant.authState,
    },
    presentationAuthUsesProviderLogin: {
      ...presentationStatus.presentationAuthUsesProviderLogin,
      [presentationMode]: runtimeVariant.authUsesProviderLogin,
    },
    capabilities: runtimeVariant.capabilities,
  };
  return runtimeVariant.authUsesProviderLogin
    ? restoreProviderLogin(status, runtimeStatus)
    : stripProviderLogin(runtimeStatus);
}

function runtimeVariantForSession(
  status: AgentStatus,
  presentationMode: ThreadPresentationMode,
  sessionRef: SessionRef | undefined,
): AgentRuntimeVariant | undefined {
  const providerSessionId = sessionRef?.providerSessionId;
  const variants = status.runtimeVariants;
  const routing = status.sessionRuntimeRouting;
  if (!providerSessionId || !variants || !routing) {
    return undefined;
  }

  let matchedRuntime: string | undefined;
  let matchedPrefixLength = -1;
  for (const [prefix, runtime] of Object.entries(routing.prefixes)) {
    const variant = variants[runtime];
    if (
      prefix.length > matchedPrefixLength &&
      providerSessionId.startsWith(prefix) &&
      variant?.presentationMode === presentationMode
    ) {
      matchedRuntime = runtime;
      matchedPrefixLength = prefix.length;
    }
  }

  const runtime = matchedRuntime ?? routing.fallbackRuntime;
  const variant = runtime ? variants[runtime] : undefined;
  return variant?.presentationMode === presentationMode ? variant : undefined;
}

/**
 * Resolve the hidden ids for one capability surface. Provider defaults apply
 * only until the user saves an explicit list; `[]` deliberately means show all.
 *
 * Curated-discovery channels (those declaring `defaultHiddenModels`, e.g.
 * OpenCode) flip the default: a model is visible only when the user has
 * explicitly shown it via `shownIds`. Everything else — including models the
 * channel started reporting after the last cleanup — stays hidden until
 * checked in 管理模型, so "the channel knows a provider" never re-adds it to
 * the picker on its own.
 */
export function resolveHiddenModelIds(
  capabilities: AgentCapability,
  hiddenIds: readonly string[] | undefined,
  shownIds?: readonly string[] | undefined,
): readonly string[] {
  const defaults = capabilities.defaultHiddenModels;
  if (!defaults || defaults.length === 0) {
    return hiddenIds ?? [];
  }
  const shown = new Set(shownIds ?? []);
  const hidden = new Set(hiddenIds ?? []);
  const defaultsSet = new Set(defaults);
  return capabilities.models
    .filter((model) => (defaultsSet.has(model.id) || hidden.has(model.id)) && !shown.has(model.id))
    .map((model) => model.id);
}

/** Return capabilities with effective hidden models filtered out. */
export function filterHiddenModels(
  capabilities: AgentCapability,
  hiddenIds: readonly string[] | undefined,
  shownIds?: readonly string[] | undefined,
): AgentCapability {
  const effectiveHiddenIds = resolveHiddenModelIds(capabilities, hiddenIds, shownIds);
  if (effectiveHiddenIds.length === 0) return capabilities;
  const hidden = new Set(effectiveHiddenIds);
  return { ...capabilities, models: capabilities.models.filter((m) => !hidden.has(m.id)) };
}

export function modelSelectionFor(
  capabilities: AgentCapability,
  model: string,
): AgentModelSelection {
  const reasoningValues = capabilities.modelEfforts?.[model] ?? capabilities.efforts ?? [];
  const modelDefault = capabilities.modelDefaultEfforts?.[model];
  // Product default is `high` everywhere: whenever the model offers a
  // high-tier effort, start there regardless of provider-reported or per-model
  // defaults (which are often `medium`). Models without a high tier keep the
  // existing default chain (per-model pin, provider default, highest).
  const highTier = resolveHighestCompatibleEffort(reasoningValues);
  const highTierValue =
    highTier && ["high", "xhigh", "max", "ultra", "extra-high"].includes(highTier.toLowerCase())
      ? highTier
      : undefined;
  const defaultReasoning =
    highTierValue ??
    (reasoningValues.includes(modelDefault ?? "")
      ? modelDefault
      : reasoningValues.includes(capabilities.defaultEffort ?? "")
        ? capabilities.defaultEffort
        : highTier);
  const fastSupported = capabilities.fastModels?.includes(model) === true;
  return {
    reasoning: {
      values: reasoningValues,
      ...(defaultReasoning ? { default: defaultReasoning } : {}),
    },
    fast: {
      supported: fastSupported,
      available: fastSupported && capabilities.fastDisabledReason === undefined,
      ...(fastSupported && capabilities.fastDisabledReason
        ? { disabledReason: capabilities.fastDisabledReason }
        : {}),
    },
  };
}

/**
 * Highest compatible reasoning tier, high-first: `high` (or equivalent) wins
 * whenever the model offers it, otherwise the strongest ranked tier. Unknown
 * tier names keep provider order (last wins). Empty means the model takes no
 * effort parameter at all — callers must omit it, never send "".
 */
export function resolveHighestCompatibleEffort(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const rank = (value: string): number => {
    switch (value.toLowerCase()) {
      case "high":
      case "xhigh":
      case "max":
      case "ultra":
      case "extra-high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  };
  let best = values[0]!;
  let bestRank = -1;
  for (const value of values) {
    const valueRank = rank(value);
    if (valueRank > bestRank) {
      best = value;
      bestRank = valueRank;
    }
  }
  return best;
}

/**
 * True when a model offers more than one reasoning level — i.e. there is
 * something for the user to pick. A single advertised level (Kimi's untiered
 * `on`) is still sent to the agent, but no picker is drawn for it, so surfaces
 * that gate on "has an effort control" must use this rather than a non-empty
 * check.
 */
export function hasSelectableReasoning(
  capabilities: AgentCapability | undefined,
  model: string,
): boolean {
  if (!capabilities) return false;
  return modelSelectionFor(capabilities, model).reasoning.values.length > 1;
}

export function resolveModelSelection(capabilities: AgentCapability, preferred?: string): string {
  return preferred && capabilities.models.some((model) => model.id === preferred)
    ? preferred
    : (capabilities.models[0]?.id ?? "");
}

export function resolveReasoningSelection(
  capabilities: AgentCapability,
  model: string,
  preferred?: string,
): string | undefined {
  return resolveCompatibleEffort(capabilities, model, preferred);
}

/**
 * Central effort compatibility rule (single normalization point for draft
 * init, model switches, and display resolution):
 * - an explicit pick the current vocabulary cannot disprove is KEPT — a model
 *   id missing from `modelEfforts` (stale probe, slug/display skew) must not
 *   clobber a valid pick into "" (the `--effort ""` outage);
 * - a model with an explicitly empty tier list genuinely takes no effort, so
 *   incompatible picks clear to undefined (callers omit the parameter);
 * - otherwise the central default chain applies (per-model pin, provider
 *   default, highest compatible). Never returns "".
 */
export function resolveCompatibleEffort(
  capabilities: AgentCapability,
  model: string,
  preferred?: string,
): string | undefined {
  const reasoning = modelSelectionFor(capabilities, model).reasoning;
  if (preferred) {
    if (reasoning.values.length === 0) {
      if (!(model in (capabilities.modelEfforts ?? {}))) return preferred;
    } else if (reasoning.values.includes(preferred)) {
      return preferred;
    }
  }
  return reasoning.default;
}

const BYPASS_APPROVAL_IDS = new Set(["bypassPermissions", "never", "yolo", "dontAsk"]);
const BYPASS_SANDBOX_IDS = new Set(["danger-full-access", "yolo"]);

function advertisedIds(options: readonly { id: string }[] | undefined): Set<string> {
  return new Set((options ?? []).map((option) => option.id));
}

function mapIncompatibleOption(
  current: string,
  advertised: Set<string>,
  declaredBypass: string | undefined,
  declaredDefault: string | undefined,
  bypassIds: ReadonlySet<string>,
): string | undefined {
  if (advertised.has(current)) return current;
  if (bypassIds.has(current)) {
    if (declaredBypass && (advertised.size === 0 || advertised.has(declaredBypass))) {
      return declaredBypass;
    }
    for (const id of bypassIds) {
      if (advertised.has(id)) return id;
    }
  }
  if (declaredDefault && (advertised.size === 0 || advertised.has(declaredDefault))) {
    return declaredDefault;
  }
  return advertised.values().next().value;
}

/**
 * Rewrite a live thread config so it is legal on a different agent's
 * capability surface. Mid-thread model switches copy the source config
 * wholesale; Grok's `bypassPermissions` is not a Codex variant, and the
 * composer permission chip cannot change a value that is not in the target
 * preset list.
 */
export function adaptThreadConfigForCapabilities(
  config: ThreadConfig,
  capabilities: AgentCapability,
): ThreadConfig {
  const approvalIds = advertisedIds(capabilities.approvalPolicies);
  const sandboxIds = advertisedIds(capabilities.sandboxModes);
  const modeIds = new Set(capabilities.modes);

  let approvalPolicy = config.approvalPolicy;
  if (approvalPolicy && !approvalIds.has(approvalPolicy)) {
    approvalPolicy =
      approvalIds.size === 0
        ? undefined
        : mapIncompatibleOption(
            approvalPolicy,
            approvalIds,
            capabilities.bypassPermissions?.approvalPolicy,
            capabilities.defaultApprovalPolicy,
            BYPASS_APPROVAL_IDS,
          );
  }

  let sandboxMode = config.sandboxMode;
  if (sandboxMode && !sandboxIds.has(sandboxMode)) {
    sandboxMode =
      sandboxIds.size === 0
        ? undefined
        : mapIncompatibleOption(
            sandboxMode,
            sandboxIds,
            capabilities.bypassPermissions?.sandboxMode,
            capabilities.defaultSandboxMode,
            BYPASS_SANDBOX_IDS,
          );
  }

  const sourceWasBypass = Boolean(
    config.approvalPolicy && BYPASS_APPROVAL_IDS.has(config.approvalPolicy),
  );
  if (
    sourceWasBypass &&
    !sandboxMode &&
    capabilities.bypassPermissions?.sandboxMode &&
    (sandboxIds.size === 0 || sandboxIds.has(capabilities.bypassPermissions.sandboxMode))
  ) {
    sandboxMode = capabilities.bypassPermissions.sandboxMode;
  }

  let mode = config.mode;
  if (mode && modeIds.size > 0 && !modeIds.has(mode)) {
    mode = modeIds.has("agent") ? "agent" : capabilities.modes[0];
  }

  const effort = resolveCompatibleEffort(capabilities, config.model, config.effort);
  const {
    approvalPolicy: _approvalPolicy,
    sandboxMode: _sandboxMode,
    effort: _effort,
    mode: _mode,
    ...rest
  } = config;

  return {
    ...rest,
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(mode ? { mode } : {}),
    ...(effort ? { effort } : {}),
  };
}

export function validateAgentModelSelection(
  capabilities: AgentCapability,
  input: { model: string; reasoning?: string; fast?: boolean },
): string | undefined {
  if (!capabilities.models.some((model) => model.id === input.model)) {
    return `Unknown model: ${input.model}`;
  }
  const selection = modelSelectionFor(capabilities, input.model);
  if (input.reasoning && !selection.reasoning.values.includes(input.reasoning)) {
    return `Unsupported reasoning for ${input.model}: ${input.reasoning}`;
  }
  if (input.fast === true && !selection.fast.supported) {
    return `Fast is not supported by ${input.model}`;
  }
  if (input.fast === true && !selection.fast.available) {
    return selection.fast.disabledReason ?? `Fast is unavailable for ${input.model}`;
  }
  return undefined;
}
