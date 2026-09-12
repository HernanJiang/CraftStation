import type { ThreadConfig } from "@/shared/contracts";
import { ANTIGRAVITY_DEFAULT_MODEL_ID } from "./detection";
import { ANTIGRAVITY_KNOWN_MODEL_VARIANTS, splitModelEffort } from "./models";

function slugifyModelPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isAgyModelSlug(value: string): boolean {
  return /^[a-z0-9.]+(?:-[a-z0-9.]+)+$/i.test(value);
}

const SLUG_EFFORT_SUFFIXES = [
  "extra-high",
  "thinking",
  "balanced",
  "medium",
  "high",
  "low",
] as const;

function titleCaseEffort(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function splitPersistedModel(value: string): { model: string; effort?: string } | undefined {
  const display = splitModelEffort(value);
  if (display) return display;
  const lower = value.toLowerCase();
  for (const slug of SLUG_EFFORT_SUFFIXES) {
    if (lower.endsWith(`-${slug}`) && lower.length > slug.length + 1) {
      return {
        model: value.slice(0, -(slug.length + 1)),
        effort: titleCaseEffort(slug),
      };
    }
  }
  return undefined;
}

function baseSlugFor(baseModel: string): string {
  if (isAgyModelSlug(baseModel)) return baseModel.toLowerCase();
  const variant = ANTIGRAVITY_KNOWN_MODEL_VARIANTS.find((item) => item.model === baseModel);
  if (variant?.cliSlug) {
    return variant.cliSlug.replace(/-(?:low|medium|high|balanced|extra-high|thinking)$/i, "");
  }
  return slugifyModelPart(baseModel);
}

/**
 * Effort options for a base model id in EITHER vocabulary: display names
 * ("Gemini 3.8 Flash") and slug ids ("gemini-3.8-flash", as emitted by
 * `agy models` since 1.1.5 and persisted in older configs). Slug bases match
 * against known cliSlug prefixes. Empty means the family takes no effort
 * (effort-less models) or is entirely unknown — both stay bare downstream.
 */
function familyEffortOptions(baseModel: string): string[] {
  const direct = ANTIGRAVITY_KNOWN_MODEL_VARIANTS.filter(
    (item) => item.model === baseModel && item.effort,
  ).map((item) => item.effort as string);
  if (direct.length > 0 || !isAgyModelSlug(baseModel)) return direct;
  const baseLower = baseModel.toLowerCase();
  const family = new Set<string>();
  for (const item of ANTIGRAVITY_KNOWN_MODEL_VARIANTS) {
    if (!item.effort || !item.cliSlug) continue;
    const cliBase = item.cliSlug
      .toLowerCase()
      .replace(/-(low|medium|high|balanced|extra-high|thinking)$/, "");
    if (cliBase === baseLower) family.add(item.effort);
  }
  return [...family];
}

function resolvedModelSelection(
  model: string | undefined,
  effort?: string,
  defaultModel = ANTIGRAVITY_DEFAULT_MODEL_ID,
) {
  const normalizedModel = !model || model === "auto" ? defaultModel : model;
  const persisted = splitPersistedModel(normalizedModel);
  let baseModel = persisted?.model ?? normalizedModel;
  if (
    !ANTIGRAVITY_KNOWN_MODEL_VARIANTS.some((item) => item.model === baseModel) &&
    !isAgyModelSlug(baseModel)
  ) {
    // Unknown display names fall back to the default instead of emitting an
    // id the CLI rejects as unknown (e.g. retired families).
    baseModel = defaultModel;
  }
  // Slug-form ids ("gemini-3.8-flash") resolve zero efforts by display match
  // alone, which used to emit the bare base (`invalid model selection`).
  // Matching known cliSlug bases keeps a full catalog id on the wire.
  const knownEfforts = familyEffortOptions(baseModel);
  const requested = effort?.trim() || persisted?.effort;
  const canonical = requested
    ? (knownEfforts.find((known) => known.toLowerCase() === requested.toLowerCase()) ??
      (knownEfforts.includes("Medium") ? "Medium" : knownEfforts[0]))
    : knownEfforts.includes("Medium")
      ? "Medium"
      : knownEfforts[0];
  // Dynamic slug models keep the raw request (the probe owns their vocabulary);
  // known models always resolve to an offered effort (or none).
  const selectedEffort = knownEfforts.length > 0 ? canonical : requested;
  return { baseModel, selectedEffort };
}

export function resolveAntigravityModel(
  model: string | undefined,
  effort?: string,
  defaultModel = ANTIGRAVITY_DEFAULT_MODEL_ID,
): string {
  const { baseModel, selectedEffort } = resolvedModelSelection(model, effort, defaultModel);
  const knownEfforts = familyEffortOptions(baseModel);
  const effectiveEffort = knownEfforts.length > 0 ? selectedEffort : undefined;
  if (isAgyModelSlug(baseModel)) {
    return effectiveEffort ? `${baseModel}-${slugifyModelPart(effectiveEffort)}` : baseModel;
  }
  const variant = ANTIGRAVITY_KNOWN_MODEL_VARIANTS.find(
    (item) =>
      item.model === baseModel && (effectiveEffort ? item.effort === effectiveEffort : true),
  );
  if (variant) return variant.cliModel;
  if (
    effectiveEffort &&
    ANTIGRAVITY_KNOWN_MODEL_VARIANTS.some((item) => item.model === baseModel)
  ) {
    return `${slugifyModelPart(baseModel)}-${slugifyModelPart(effectiveEffort)}`;
  }
  return effectiveEffort ? `${baseModel} (${effectiveEffort})` : baseModel;
}

const CLI_EFFORT_FLAGS = new Set(["low", "medium", "high"]);

function buildSeparateModelEffortArgs(
  model: string | undefined,
  effort?: string,
  defaultModel = ANTIGRAVITY_DEFAULT_MODEL_ID,
  emitEffortFlag = false,
): string[] {
  const selection = resolvedModelSelection(model, effort, defaultModel);
  if (emitEffortFlag) {
    const args = ["--model", baseSlugFor(selection.baseModel)];
    const effortSlug = selection.selectedEffort?.trim()
      ? slugifyModelPart(selection.selectedEffort)
      : undefined;
    // Never send `--effort ""`: current agy rejects empty effort on families
    // that require one (`gemini-3.8-flash requires --effort`). Only emit the
    // CLI's documented low|medium|high values — "thinking" stays in the model id.
    if (effortSlug && CLI_EFFORT_FLAGS.has(effortSlug)) args.push("--effort", effortSlug);
    return args;
  }
  const variant = ANTIGRAVITY_KNOWN_MODEL_VARIANTS.find(
    (item) =>
      item.model === selection.baseModel &&
      (selection.selectedEffort ? item.effort === selection.selectedEffort : !item.effort),
  );
  // Older agy (1.1.26/1.1.27) resolves `--model` against full catalog ids and
  // rejects a separate `--effort` (`--effort is not supported for model`).
  if (variant?.cliSlug) return ["--model", variant.cliSlug];
  if (isAgyModelSlug(selection.baseModel)) {
    return [
      "--model",
      selection.selectedEffort?.trim()
        ? `${selection.baseModel}-${slugifyModelPart(selection.selectedEffort)}`
        : selection.baseModel,
    ];
  }
  return ["--model", slugifyModelPart(selection.baseModel)];
}

export function buildAntigravityModelArgs(
  model: string | undefined,
  effort?: string,
  separateModelEffort = true,
  defaultModel = ANTIGRAVITY_DEFAULT_MODEL_ID,
  emitEffortFlag = false,
): string[] {
  return separateModelEffort || emitEffortFlag
    ? buildSeparateModelEffortArgs(model, effort, defaultModel, emitEffortFlag)
    : ["--model", resolveAntigravityModel(model, effort, defaultModel)];
}

/**
 * `agy` abandons a print-mode wait after its own `--print-timeout` default
 * (5m) and then reports whatever it has as a plain SUCCESS result, so a turn
 * that legitimately runs longer is silently cut off mid-task with no error.
 * The GUI lane owns the session lifetime (Stop and the force-stop watchdog
 * close a hung turn), so widen the wait rather than inheriting the provider
 * default. `0` is NOT "unlimited" — it returns partial output immediately.
 */
export const ANTIGRAVITY_PRINT_WAIT_TIMEOUT = "24h";

export function buildAntigravityPrintTimeoutArgs(supported: boolean): string[] {
  return supported ? [`--print-timeout=${ANTIGRAVITY_PRINT_WAIT_TIMEOUT}`] : [];
}

export function buildAntigravityArgs(
  config: ThreadConfig,
  prompt: string,
  resumeConversationId?: string,
  separateModelEffort = true,
  defaultModel = ANTIGRAVITY_DEFAULT_MODEL_ID,
  emitEffortFlag = false,
): string[] {
  const args: string[] = [];

  if (resumeConversationId) {
    args.push("--conversation", resumeConversationId);
  }
  args.push(
    ...buildAntigravityModelArgs(
      config.model,
      config.effort,
      separateModelEffort,
      defaultModel,
      emitEffortFlag,
    ),
  );
  if (config.mode === "plan") {
    args.push("--mode", "plan");
  } else if (config.approvalPolicy === "accept-edits") {
    args.push("--mode", "accept-edits");
  }
  if (config.approvalPolicy === "never" || config.approvalPolicy === "yolo") {
    args.push("--dangerously-skip-permissions");
  }
  if (config.sandboxMode === "sandbox") {
    args.push("--sandbox");
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt-interactive", prompt);
  }
  return args;
}
