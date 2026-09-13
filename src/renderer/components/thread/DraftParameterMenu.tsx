import { useMemo, useState } from "react";
import { Button, Dropdown, Input, Label, Modal, TextField } from "@heroui/react";
import { Check, ChevronDown, Cpu, Gauge, Sparkles } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { overlayZoomClasses, withOverlayClass } from "@/renderer/components/common/overlayZoom";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { resolveRecipePickerTarget } from "@/renderer/crafting/recipePickerTarget";
import {
  COMPATIBILITY_FAMILY_LABELS,
  COMPATIBILITY_HARNESS_LABELS,
  isNativeModelHarnessPair,
  preferredHarnessForCompatibilityFamily,
  resolveCompatibilityFamily,
  type CompatibilityHarnessId,
} from "@/shared/harnessCompatibility";
import {
  applyThirdPartyPickerSelection,
  isThirdPartyAccountId,
  resolveThirdPartyHarnessForModel,
} from "@/shared/thirdPartyRouting";
import type { ComposerControl } from "./ThreadComposer";
import { CONTEXT_WINDOW_PRESETS, resolveContextPresetValue } from "./threadDraftViewHelpers";

export function DraftParameterMenu(props: { controls: ComposerControl[] }) {
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const installedHarnesses = useMemo(
    () =>
      [...agentStatuses, ...wslAgentStatuses]
        .filter((entry) => entry.installed)
        .map((entry) => entry.kind),
    [agentStatuses, wslAgentStatuses],
  );
  const modelControl = props.controls.find((control) => control.kind === "provider-model");
  const effortControl = props.controls.find((control) => control.kind === "effort-context");
  const selectedProvider = modelControl?.providers.find(
    (provider) =>
      provider.kind === modelControl.currentAgentKind &&
      provider.accountId === modelControl.currentAccountId,
  );
  const selectedModel = selectedProvider?.capabilities.models.find(
    (candidate) => candidate.id === modelControl?.currentModel,
  );
  const effortLabel =
    effortControl?.efforts.find((candidate) => candidate.id === effortControl.effortValue)
      ?.label ?? effortControl?.effortValue;
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
  // 合成台「我的配方」：在管理模型勾选进首页的配方，选中即套用其底层模型
  //（Harness 走既有自动路由）。底层模型已消失的配方仅管理页可见，不进选择器。
  const homepageRecipes = useCraftingWorkbenchStore((state) => state.recipes).filter(
    (recipe) => recipe.homepageVisible === true,
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
  const label = [selectedModel?.label || currentModelLabel || "自定义", effortLabel]
    .filter(Boolean)
    .join(" · ");

  // The system picks Model + Harness: show both identities on one row so
  // Provider (who serves the API) is never confused with Model Family (what
  // the model is) or Harness (what runs it). Always visible when resolvable —
  // never gated on a mode flag.
  const thirdPartyPick = isThirdPartyAccountId(modelControl?.currentAccountId);
  const autoHarness: CompatibilityHarnessId | undefined =
    modelControl && currentModelLabel
      ? thirdPartyPick
        ? resolveThirdPartyHarnessForModel(currentModelLabel, installedHarnesses)
        : preferredHarnessForCompatibilityFamily(resolveCompatibilityFamily(currentModelLabel))
      : undefined;
  const autoNative =
    autoHarness !== undefined &&
    modelControl !== undefined &&
    !thirdPartyPick &&
    isNativeModelHarnessPair({ providerId: modelControl.currentAgentKind, harnessId: autoHarness });
  // Native: name the Harness after the CLI product the account belongs to
  // (e.g. "Kimi Code", "Grok Build") — never the model family name, which is
  // what made "Kimi · K3-256k" unreadable. Compatibility: affinity CLI name.
  const autoHarnessName =
    autoHarness !== undefined
      ? autoNative && selectedProvider
        ? selectedProvider.label
        : COMPATIBILITY_HARNESS_LABELS[autoHarness]
      : undefined;
  const autoTitle =
    autoHarness !== undefined && modelControl
      ? `Provider: ${selectedProvider?.label ?? modelControl.currentAgentKind} · Family: ${
          COMPATIBILITY_FAMILY_LABELS[resolveCompatibilityFamily(currentModelLabel ?? "")]
        } · Harness: ${autoHarnessName ?? COMPATIBILITY_HARNESS_LABELS[autoHarness]} · Route: ${
          autoNative ? "Native" : "Compatibility"
        }`
      : undefined;
  const nativeHarnessMatchesProvider =
    autoNative && autoHarness !== undefined && autoHarness === modelControl?.currentAgentKind;

  return (
    <>
    <Dropdown>
      <Dropdown.Trigger className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
        {modelControl ? (
          <span
            className="flex items-center gap-1 whitespace-nowrap leading-tight"
            data-testid="auto-harness-model"
            {...(autoTitle ? { title: autoTitle } : {})}
          >
            {autoHarness !== undefined && autoHarnessName !== undefined ? (
              <>
                <ProviderIcon
                  kind={autoHarness}
                  fallbackLabel={autoHarnessName}
                  tone="active"
                  className="size-3.5 shrink-0"
                />
                <span className="shrink-0" data-testid="auto-harness-name">
                  {autoHarnessName}
                </span>
                <span className="shrink-0 text-muted" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            {nativeHarnessMatchesProvider ? null : (
              <ProviderIcon
                kind={modelControl.currentAgentKind}
                {...(selectedProvider?.icon ? { icon: selectedProvider.icon } : {})}
                fallbackLabel={selectedProvider?.label}
                tone="active"
                className="size-3.5 shrink-0"
              />
            )}
            <span className="whitespace-nowrap">{label}</span>
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
          aria-label="模型与运行参数"
          {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
        >
          {effortControl && effortControl.contextSizes.length > 0 ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="context" textValue="上下文窗口大小">
                <Gauge className="size-4 text-muted" />
                <Label>上下文窗口大小</Label>
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
                    aria-label="上下文窗口大小"
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
                          <span className="ml-auto text-[10px] text-neutral-500">默认</span>
                        ) : null}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                  <div className="border-t border-white/10 p-2">
                    <input
                      aria-label="自定义上下文窗口大小"
                      value={customContextDraft}
                      onChange={(event) => setCustomContextDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyCustomContext();
                        }
                      }}
                      placeholder="自定义，如 200K / 500000，回车应用"
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-neutral-500 focus:border-white/25"
                    />
                  </div>
                </div>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : null}

          {modelControl ? (
            <Dropdown.SubmenuTrigger delay={0}>
              <Dropdown.Item id="models" textValue="模型列表">
                <Cpu className="size-4 text-muted" />
                <Label>模型列表</Label>
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
                  aria-label="模型列表"
                  {...(overlayZoom.content ? { className: overlayZoom.content } : {})}
                >
                  {recipeTargets.map(({ recipe, target }) => {
                    const name = recipe.alias?.trim() || recipe.systemName;
                    const recipeHarnessKind = recipe.harnessRef.replace(/^harness:/u, "");
                    const isCurrent =
                      recipeHarnessKind === modelControl.currentAgentKind &&
                      target.model === modelControl.currentModel &&
                      (target.accountId ?? undefined) ===
                        (modelControl.currentAccountId ?? undefined) &&
                      recipeHarnessKind === modelControl.currentAgentKind;
                    return (
                      <Dropdown.Item
                        key={`recipe:${recipe.id}`}
                        id={`recipe:${recipe.id}`}
                        textValue={`${name} 我的配方`}
                        onPress={() =>
                          modelControl.onChange(
                            applyThirdPartyPickerSelection(
                              {
                                // A saved recipe is an explicit composition.
                                // Its Harness wins over model-name auto-routing;
                                // otherwise an OpenCode Gemini recipe can be
                                // silently reinterpreted as Antigravity.
                                agentKind: recipeHarnessKind || target.agentKind,
                                model: target.model,
                                ...(target.presentationMode
                                  ? { presentationMode: target.presentationMode }
                                  : {}),
                                ...(target.accountId ? { accountId: target.accountId } : {}),
                              },
                              installedHarnesses,
                            ),
                          )
                        }
                      >
                        <ProviderIcon
                          kind={target.agentKind}
                          fallbackLabel={name}
                          tone="active"
                          className="size-4 shrink-0"
                        />
                        <Label className="whitespace-nowrap">{name}</Label>
                        <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted">
                          我的配方
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
                            candidateRecipe.harnessRef.replace(/^harness:/u, "") ===
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
                          onPress={() =>
                            modelControl.onChange(
                              applyThirdPartyPickerSelection(
                                {
                                  agentKind: provider.kind,
                                  model: model.id,
                                  ...(provider.presentationMode
                                    ? { presentationMode: provider.presentationMode }
                                    : {}),
                                  ...(provider.accountId ? { accountId: provider.accountId } : {}),
                                },
                                installedHarnesses,
                              ),
                            )
                          }
                        >
                          <ProviderIcon
                            kind={provider.kind}
                            {...(provider.icon ? { icon: provider.icon } : {})}
                            fallbackLabel={provider.label}
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
              <Dropdown.Item id="effort" textValue="推理强度">
                <Sparkles className="size-4 text-muted" />
                <Label>推理强度</Label>
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
                  aria-label="推理强度"
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
                    textValue="自定义思考强度"
                  >
                    <Label>自定义…</Label>
                    <span className="ml-auto whitespace-nowrap text-[10px] text-muted">
                      手写档位
                    </span>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
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
                    <Modal.Heading>自定义思考强度</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body className="flex flex-col gap-2 p-4">
                    <p className="text-[11px] text-neutral-400">
                      手写档位直接透传给模型（如 low / high / xhigh，以各厂商文档为准）。
                    </p>
                    <TextField>
                      <Label className="sr-only">思考强度</Label>
                      <Input
                        value={customEffortDraft}
                        onChange={(event) => setCustomEffortDraft(event.target.value)}
                        placeholder="如 high"
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
                      取消
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
                      应用
                    </Button>
                  </Modal.Footer>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          ) : null}
    </>
  );
}
