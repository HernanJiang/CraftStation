import { useMemo, useState } from "react";
import { Button, Dropdown, Input, Label, Modal, TextField } from "@heroui/react";
import { Check, ChevronDown, Cpu, Gauge, Sparkles, Zap } from "lucide-react";
import { MenuSwitch } from "@/renderer/components/common/MenuSwitch";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { overlayZoomClasses, withOverlayClass } from "@/renderer/components/common/overlayZoom";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { useCurrentProjectId } from "@/renderer/hooks/uiSelectors";
import {
  providerKindFromRecipeRef,
  recipeLaunchHarnessKind,
  recipeLaunchModelId,
  resolveRecipePickerTarget,
} from "@/renderer/crafting/recipePickerTarget";
import {
  COMPATIBILITY_FAMILY_LABELS,
  COMPATIBILITY_HARNESS_LABELS,
  modelFamilyIconKind,
  resolveCompatibilityFamily,
  type CompatibilityHarnessId,
} from "@/shared/harnessCompatibility";
import { getLaunchableAgentStatuses } from "@/shared/agentStatus";
import { channelInfoFromCustomModels, resolveAutoModelBinding } from "@/shared/thirdPartyRouting";
import type { ComposerControl } from "./ThreadComposer";
import { CONTEXT_WINDOW_PRESETS, resolveContextPresetValue } from "./threadDraftViewHelpers";
import { useLingui } from "@lingui/react/macro";

export function DraftParameterMenu(props: { controls: ComposerControl[] }) {
  const { t } = useLingui();
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const currentProjectId = useCurrentProjectId();
  const projectLocation = useAppStore(
    (state) => state.projects.find((project) => project.id === currentProjectId)?.location,
  );
  const installedHarnesses = useMemo(
    () =>
      getLaunchableAgentStatuses(
        projectLocation ?? { kind: "windows", path: "" },
        agentStatuses,
        wslAgentStatuses,
      )
        .filter((entry) => entry.installed)
        .map((entry) => entry.kind),
    [projectLocation, agentStatuses, wslAgentStatuses],
  );
  const modelControl = props.controls.find((control) => control.kind === "provider-model");
  const effortControl = props.controls.find((control) => control.kind === "effort-context");
  // The Fast toggle arrives as a generic toggle control; in menu mode it is a
  // row with a switch, parallel to 模型列表 / 推理强度.
  const fastControl = props.controls.find(
    (control): control is Extract<ComposerControl, { kind: "toggle" }> =>
      control.kind === "toggle" && control.iconKind === "fast",
  );
  const selectedProvider = modelControl?.providers.find(
    (provider) =>
      provider.kind === modelControl.currentAgentKind &&
      provider.accountId === modelControl.currentAccountId,
  );
  const selectedModel = selectedProvider?.capabilities.models.find(
    (candidate) => candidate.id === modelControl?.currentModel,
  );
  const effortLabel =
    effortControl?.efforts.find((candidate) => candidate.id === effortControl.effortValue)?.label ??
    effortControl?.effortValue;
  const [customEffortOpen, setCustomEffortOpen] = useState(false);
  const [customEffortDraft, setCustomEffortDraft] = useState("");
  const contextLabel =
    effortControl?.contextSizes.find((candidate) => candidate.id === effortControl.contextValue)
      ?.label ?? effortControl?.contextValue;
  // 选中模型的真实能力表（上下文档位映射需要 modelContextSizes/contextSizes）。
  const selectedCapabilities = selectedProvider?.capabilities;
  const [customContextDraft, setCustomContextDraft] = useState("");
  // Shared overlay zoom compensation (see overlayZoom.ts): empty at factor 1.
  const overlayZoom = overlayZoomClasses(useSharedSettings((state) => state.zoomFactor));
  // 合成台「我的配方」：在管理模型勾选进首页的配方，选中即套用其 Harness · 模型
  // 组合（含第三方兼容 API / CPA 链路）。Harness 不走模型名自动路由。
  const recipes = useCraftingWorkbenchStore((state) => state.recipes);
  const homepageRecipes = recipes.filter((recipe) => recipe.homepageVisible === true);
  const setPendingRecipeIntent = useCraftingWorkbenchStore((state) => state.setPendingRecipeIntent);
  const clearPendingRecipeIntent = useCraftingWorkbenchStore(
    (state) => state.clearPendingRecipeIntent,
  );
  const customModelsForRecipes = useSharedSettings((state) => state.customModels);
  const recipeTargets =
    modelControl === undefined
      ? []
      : homepageRecipes.flatMap((recipe) => {
          const target = resolveRecipePickerTarget(
            recipe,
            modelControl.providers,
            customModelsForRecipes,
          );
          return target ? [{ recipe, target }] : [];
        });

  function applyContextValue(next: string | undefined) {
    if (next) effortControl?.onContextChange?.(next);
  }

  function handleContextAction(key: string) {
    if (!effortControl) return;
    if (key.startsWith("preset:")) {
      const preset = key.slice("preset:".length);
      const mapped =
        modelControl && selectedCapabilities
          ? resolveContextPresetValue(selectedCapabilities, modelControl.currentModel, preset)
          : undefined;
      applyContextValue(mapped ?? preset);
      return;
    }
    if (key.startsWith("real:")) applyContextValue(key.slice("real:".length));
  }

  function applyCustomContext() {
    const raw = customContextDraft.trim();
    if (!raw || !effortControl) return;
    const mapped =
      modelControl && selectedCapabilities
        ? resolveContextPresetValue(selectedCapabilities, modelControl.currentModel, raw)
        : undefined;
    applyContextValue(mapped ?? raw);
    setCustomContextDraft("");
  }
  // Agent detection may temporarily expose an empty model id. Keep the Codex-style
  // parameter capsule useful instead of collapsing to a sparkles-only button.
  const currentModelLabel = modelControl?.currentModel.trim();
  const pendingRecipeIntent = useCraftingWorkbenchStore((state) => state.pendingRecipeIntent);
  const pendingRecipe = pendingRecipeIntent
    ? recipes.find((recipe) => recipe.id === pendingRecipeIntent.recipeId)
    : undefined;
  const identityRecipe =
    pendingRecipe &&
    modelControl &&
    (recipeLaunchModelId(pendingRecipe) === modelControl.currentModel ||
      pendingRecipe.lastKnownModel?.modelId === modelControl.currentModel) &&
    (recipeLaunchHarnessKind(pendingRecipe) === modelControl.currentAgentKind ||
      providerKindFromRecipeRef(pendingRecipe.modelEntryRef) === modelControl.currentAgentKind)
      ? pendingRecipe
      : modelControl
        ? recipeTargets.find(({ recipe, target }) => {
            const harness = recipeLaunchHarnessKind(recipe) || target.agentKind;
            const model = target.model || recipeLaunchModelId(recipe);
            return harness === modelControl.currentAgentKind && model === modelControl.currentModel;
          })?.recipe
        : undefined;
  const binding =
    modelControl && currentModelLabel
      ? resolveAutoModelBinding(
          {
            agentKind: modelControl.currentAgentKind,
            model: currentModelLabel,
            ...(modelControl.currentAccountId ? { accountId: modelControl.currentAccountId } : {}),
          },
          installedHarnesses,
          channelInfoFromCustomModels(
            customModelsForRecipes,
            modelControl.currentAccountId,
            currentModelLabel,
          ),
          useSharedSettings.getState().compatDefaultHarness,
        )
      : undefined;
  const harnessKind =
    (identityRecipe ? recipeLaunchHarnessKind(identityRecipe) : undefined) ||
    binding?.harnessId ||
    modelControl?.currentAgentKind;
  const catalogHarnessLabel =
    harnessKind && harnessKind in COMPATIBILITY_HARNESS_LABELS
      ? COMPATIBILITY_HARNESS_LABELS[harnessKind as CompatibilityHarnessId]
      : undefined;
  const autoHarnessName = identityRecipe
    ? (identityRecipe.lastKnownHarness?.displayName ??
      catalogHarnessLabel ??
      selectedProvider?.label)
    : harnessKind && harnessKind !== modelControl?.currentAgentKind
      ? (catalogHarnessLabel ?? selectedProvider?.label)
      : (selectedProvider?.label ?? catalogHarnessLabel);
  const modelFromAnyProvider = modelControl?.providers
    .flatMap((provider) => provider.capabilities.models)
    .find(
      (candidate) =>
        candidate.id === modelControl.currentModel ||
        candidate.id.split("/").pop()?.toLowerCase() ===
          modelControl.currentModel.split("/").pop()?.toLowerCase(),
    );
  const modelDisplayName =
    identityRecipe?.lastKnownModel?.displayName ||
    selectedModel?.label ||
    modelFromAnyProvider?.label ||
    currentModelLabel ||
    t`自定义`;
  const modelIconKind = currentModelLabel
    ? modelFamilyIconKind(
        (identityRecipe ? recipeLaunchModelId(identityRecipe) : undefined) ?? currentModelLabel,
      )
    : undefined;
  const fastTierLabel = fastControl?.speedTiers?.find(
    (tier) => tier.id === fastControl.speedTierValue,
  )?.label;
  const label = [
    modelDisplayName,
    effortLabel,
    ...(fastControl?.isSelected ? [fastTierLabel ?? "Fast"] : []),
  ]
    .filter(Boolean)
    .join(" · ");
  const familyLabel = currentModelLabel
    ? COMPATIBILITY_FAMILY_LABELS[resolveCompatibilityFamily(currentModelLabel)]
    : undefined;
  const autoTitle =
    autoHarnessName !== undefined && modelControl
      ? `Harness: ${autoHarnessName} · Model: ${modelDisplayName}${
          familyLabel ? ` · Family: ${familyLabel}` : ""
        }`
      : undefined;

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger className="craftstation-composer-parameters inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
          {modelControl ? (
            <span
              className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap leading-tight"
              data-testid="auto-harness-model"
              {...(autoTitle ? { title: autoTitle } : {})}
            >
              {autoHarnessName !== undefined && harnessKind !== undefined ? (
                <>
                  <ProviderIcon
                    kind={harnessKind}
                    fallbackLabel={autoHarnessName}
                    tone="active"
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 max-w-[7rem] truncate" data-testid="auto-harness-name">
                    {autoHarnessName}
                  </span>
                  <span className="shrink-0 text-muted" aria-hidden="true">
                    ·
                  </span>
                </>
              ) : null}
              {modelIconKind ? (
                <ProviderIcon
                  kind={modelIconKind}
                  fallbackLabel={modelDisplayName}
                  tone="active"
                  className="size-3.5 shrink-0"
                />
              ) : null}
              <span className="min-w-0 truncate" data-testid="auto-model-name" title={label}>
                {label}
              </span>
            </span>
          ) : (
            <Sparkles className="size-3.5 text-violet-300" />
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </Dropdown.Trigger>
        <Dropdown.Popover
          placement="top end"
          className={withOverlayClass(
            "craftstation-composer-menu-surface w-max min-w-[20rem] max-w-[min(36rem,calc(100vw-1.5rem))] rounded-[14px]",
            overlayZoom.root,
          )}
        >
          <Dropdown.Menu
            aria-label={t`模型与运行参数`}
            {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
          >
            {effortControl && effortControl.contextSizes.length > 0 ? (
              <Dropdown.SubmenuTrigger>
                <Dropdown.Item id="context" textValue={t`上下文窗口大小`}>
                  <Gauge className="size-4 text-muted" />
                  <Label>{t`上下文窗口大小`}</Label>
                  <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                    {contextLabel}
                  </span>
                  <Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover
                  placement="left top"
                  className={withOverlayClass(
                    "craftstation-composer-menu-surface w-max min-w-[16rem] max-w-[min(28rem,calc(100vw-1.5rem))] rounded-[14px]",
                    overlayZoom.root,
                  )}
                >
                  <div className={withOverlayClass("flex flex-col", overlayZoom.content)}>
                    <Dropdown.Menu
                      aria-label={t`上下文窗口大小`}
                      onAction={(key) => handleContextAction(String(key))}
                    >
                      {CONTEXT_WINDOW_PRESETS.map((preset) => (
                        <Dropdown.Item
                          key={`preset:${preset}`}
                          id={`preset:${preset}`}
                          textValue={preset}
                        >
                          <Label>{preset}</Label>
                          {preset === "256K" ? (
                            <span className="ml-auto text-[10px] text-neutral-500">{t`默认`}</span>
                          ) : null}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                    <div className="border-t border-white/10 p-2">
                      <input
                        aria-label={t`自定义上下文窗口大小`}
                        value={customContextDraft}
                        onChange={(event) => setCustomContextDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyCustomContext();
                          }
                        }}
                        placeholder={t`自定义，如 200K / 500000，回车应用`}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-neutral-500 focus:border-white/25"
                      />
                    </div>
                  </div>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
            ) : null}

            {modelControl ? (
              <Dropdown.SubmenuTrigger delay={0}>
                <Dropdown.Item id="models" textValue={t`模型列表`}>
                  <Cpu className="size-4 text-muted" />
                  <Label>{t`模型列表`}</Label>
                  <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                    {selectedModel?.label}
                  </span>
                  <Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover
                  placement="left top"
                  className={withOverlayClass(
                    "craftstation-composer-menu-surface max-h-[420px] w-max min-w-[20rem] max-w-[min(36rem,calc(100vw-1.5rem))] rounded-[14px]",
                    overlayZoom.root,
                  )}
                >
                  <Dropdown.Menu
                    aria-label={t`模型列表`}
                    {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
                  >
                    {recipeTargets.map(({ recipe, target }) => {
                      const name = recipe.alias?.trim() || recipe.systemName;
                      const recipeHarnessKind = recipeLaunchHarnessKind(recipe) || target.agentKind;
                      const recipeModel = target.model || recipeLaunchModelId(recipe);
                      const isCurrent =
                        recipeHarnessKind === modelControl.currentAgentKind &&
                        recipeModel === modelControl.currentModel &&
                        (target.accountId ?? undefined) ===
                          (modelControl.currentAccountId ?? undefined);
                      return (
                        <Dropdown.Item
                          key={`recipe:${recipe.id}`}
                          id={`recipe:${recipe.id}`}
                          textValue={t`${name} 我的配方`}
                          onPress={() => {
                            setPendingRecipeIntent({ recipeId: recipe.id });
                            modelControl.onChange({
                              // A saved recipe is an explicit composition.
                              // Its Harness wins over model-name auto-routing.
                              agentKind: recipeHarnessKind || target.agentKind,
                              model: recipeModel ?? target.model,
                              ...(target.presentationMode
                                ? { presentationMode: target.presentationMode }
                                : {}),
                              ...(target.accountId ? { accountId: target.accountId } : {}),
                            });
                          }}
                        >
                          <ProviderIcon
                            kind={target.agentKind}
                            fallbackLabel={name}
                            tone="active"
                            className="size-4 shrink-0"
                          />
                          <Label className="whitespace-nowrap">{name}</Label>
                          <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted">
                            {t`我的配方`}
                          </span>
                          {isCurrent ? <Check className="size-3.5 text-emerald-400" /> : null}
                        </Dropdown.Item>
                      );
                    })}
                    {modelControl.providers.flatMap((provider, providerIndex) =>
                      provider.capabilities.models.map((model) => {
                        const isCurrent =
                          provider.kind === modelControl.currentAgentKind &&
                          provider.accountId === modelControl.currentAccountId &&
                          model.id === modelControl.currentModel &&
                          !recipeTargets.some(
                            ({ recipe: candidateRecipe, target: candidateTarget }) =>
                              recipeLaunchHarnessKind(candidateRecipe) ===
                                modelControl.currentAgentKind &&
                              candidateTarget.model === modelControl.currentModel &&
                              (candidateTarget.accountId ?? undefined) ===
                                (modelControl.currentAccountId ?? undefined),
                          );
                        return (
                          <Dropdown.Item
                            key={`${providerIndex}:${provider.kind}:${model.id}`}
                            id={`${providerIndex}:${provider.kind}:${model.id}`}
                            textValue={`${provider.label} ${model.label}`}
                            onPress={() => {
                              clearPendingRecipeIntent();
                              modelControl.onChange({
                                agentKind: provider.kind,
                                model: model.id,
                                ...(provider.presentationMode
                                  ? { presentationMode: provider.presentationMode }
                                  : {}),
                                ...(provider.accountId ? { accountId: provider.accountId } : {}),
                              });
                            }}
                          >
                            <ProviderIcon
                              kind={modelFamilyIconKind(model.id) ?? provider.kind}
                              {...(provider.icon && !modelFamilyIconKind(model.id)
                                ? { icon: provider.icon }
                                : {})}
                              fallbackLabel={model.label}
                              tone="active"
                              className="size-4 shrink-0"
                            />
                            <Label className="whitespace-nowrap">{model.label}</Label>
                            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted">
                              {provider.label}
                            </span>
                            {isCurrent ? <Check className="size-3.5 text-emerald-400" /> : null}
                          </Dropdown.Item>
                        );
                      }),
                    )}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
            ) : null}

            {effortControl ? (
              <Dropdown.SubmenuTrigger>
                <Dropdown.Item id="effort" textValue={t`推理强度`}>
                  <Sparkles className="size-4 text-muted" />
                  <Label>{t`推理强度`}</Label>
                  <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                    {effortLabel}
                  </span>
                  <Dropdown.SubmenuIndicator />
                </Dropdown.Item>
                <Dropdown.Popover
                  placement="left top"
                  className={withOverlayClass(
                    "craftstation-composer-menu-surface w-max min-w-[12rem] max-w-[min(24rem,calc(100vw-1.5rem))] rounded-[14px]",
                    overlayZoom.root,
                  )}
                >
                  <Dropdown.Menu
                    aria-label={t`推理强度`}
                    onAction={(key) => {
                      if (key === "__custom_effort__") {
                        setCustomEffortDraft(effortControl.effortValue ?? "");
                        setCustomEffortOpen(true);
                        return;
                      }
                      effortControl.onEffortChange?.(String(key));
                    }}
                    {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
                  >
                    {effortControl.efforts.map((effort) => (
                      <Dropdown.Item key={effort.id} id={effort.id} textValue={effort.label}>
                        <Label>{effort.label}</Label>
                      </Dropdown.Item>
                    ))}
                    <Dropdown.Item
                      key="__custom_effort__"
                      id="__custom_effort__"
                      textValue={t`自定义思考强度`}
                    >
                      <Label>{t`自定义…`}</Label>
                      <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                        {t`手写档位`}
                      </span>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.SubmenuTrigger>
            ) : null}

            {fastControl ? (
              fastControl.speedTiers && fastControl.speedTiers.length > 1 ? (
                // 多速度档（Codex priority + ultrafast）：档位选择与开关合一,
                // 与「推理强度」同构的子菜单，首项为关闭（标准档）。
                <Dropdown.SubmenuTrigger>
                  <Dropdown.Item
                    id="fast"
                    textValue={
                      fastControl.disabledReason
                        ? t`快速模式 ${fastControl.disabledReason}`
                        : t`快速模式`
                    }
                    isDisabled={
                      fastControl.isDisabled === true || Boolean(fastControl.disabledReason)
                    }
                  >
                    <Zap
                      className={`size-4 ${
                        fastControl.isSelected ? "text-amber-300" : "text-muted"
                      }`}
                    />
                    <Label>{t`快速模式`}</Label>
                    {fastControl.disabledReason ? (
                      <span
                        className="ml-auto max-w-44 truncate whitespace-nowrap text-[10px] text-muted"
                        title={fastControl.disabledReason}
                      >
                        {fastControl.disabledReason}
                      </span>
                    ) : (
                      <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                        {fastControl.isSelected ? (fastTierLabel ?? "Fast") : t`关闭`}
                      </span>
                    )}
                    <Dropdown.SubmenuIndicator />
                  </Dropdown.Item>
                  <Dropdown.Popover
                    placement="left top"
                    className={withOverlayClass(
                      "craftstation-composer-menu-surface w-max min-w-[12rem] max-w-[min(24rem,calc(100vw-1.5rem))] rounded-[14px]",
                      overlayZoom.root,
                    )}
                  >
                    <Dropdown.Menu
                      aria-label={t`快速模式`}
                      onAction={(key) =>
                        fastControl.onSpeedTierChange?.(
                          String(key) === "__off__" ? undefined : String(key),
                        )
                      }
                      {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
                    >
                      <Dropdown.Item id="__off__" textValue={t`标准`}>
                        <Label>{t`标准`}</Label>
                        {!fastControl.isSelected ? (
                          <Check className="ml-auto size-3.5 text-emerald-400" />
                        ) : null}
                      </Dropdown.Item>
                      {fastControl.speedTiers.map((tier) => (
                        <Dropdown.Item key={tier.id} id={tier.id} textValue={tier.label}>
                          <Label>{tier.label}</Label>
                          {fastControl.isSelected && fastControl.speedTierValue === tier.id ? (
                            <Check className="ml-auto size-3.5 text-emerald-400" />
                          ) : null}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown.SubmenuTrigger>
              ) : (
                <Dropdown.Item
                  id="fast"
                  textValue={
                    fastControl.disabledReason
                      ? t`快速模式 ${fastControl.disabledReason}`
                      : t`快速模式`
                  }
                  isDisabled={
                    fastControl.isDisabled === true || Boolean(fastControl.disabledReason)
                  }
                  onPress={() => fastControl.onChange?.(!fastControl.isSelected)}
                >
                  <Zap
                    className={`size-4 ${fastControl.isSelected ? "text-amber-300" : "text-muted"}`}
                  />
                  <Label>{t`快速模式`}</Label>
                  {fastControl.disabledReason ? (
                    <span
                      className="ml-auto max-w-44 truncate whitespace-nowrap text-[10px] text-muted"
                      title={fastControl.disabledReason}
                    >
                      {fastControl.disabledReason}
                    </span>
                  ) : (
                    <MenuSwitch checked={fastControl.isSelected} />
                  )}
                </Dropdown.Item>
              )
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {effortControl ? (
        <Modal.Backdrop
          isOpen={customEffortOpen}
          onOpenChange={(open) => !open && setCustomEffortOpen(false)}
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t`自定义思考强度`}</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-2 p-4">
                <p className="text-[11px] text-neutral-400">
                  {t`手写档位直接透传给模型（如 low / high / xhigh，以各厂商文档为准）。`}
                </p>
                <TextField>
                  <Label className="sr-only">{t`思考强度`}</Label>
                  <Input
                    value={customEffortDraft}
                    onChange={(event) => setCustomEffortDraft(event.target.value)}
                    placeholder={t`如 high`}
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  slot="close"
                  variant="ghost"
                  size="sm"
                  className="text-muted"
                  onPress={() => setCustomEffortOpen(false)}
                >
                  {t`取消`}
                </Button>
                <Button
                  variant="tertiary"
                  size="sm"
                  className="text-white"
                  isDisabled={customEffortDraft.trim().length === 0}
                  onPress={() => {
                    effortControl.onEffortChange?.(customEffortDraft.trim());
                    setCustomEffortOpen(false);
                  }}
                >
                  {t`应用`}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}
    </>
  );
}
