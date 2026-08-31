import { useState } from "react";
import { Dropdown, Label } from "@heroui/react";
import { Check, ChevronDown, Cpu, Gauge, Sparkles } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import type { ComposerControl } from "./ThreadComposer";
import { CONTEXT_WINDOW_PRESETS, resolveContextPresetValue } from "./threadDraftViewHelpers";

export function DraftParameterMenu(props: { controls: ComposerControl[] }) {
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
  const effortLabel = effortControl?.efforts.find(
    (candidate) => candidate.id === effortControl.effortValue,
  )?.label;
  // 选中模型的真实能力表（上下文档位映射需要 modelContextSizes/contextSizes）。
  const selectedCapabilities = selectedProvider?.capabilities;
  const [customContextDraft, setCustomContextDraft] = useState("");

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

  return (
    <Dropdown>
      <Dropdown.Trigger className="inline-flex h-9 max-w-[210px] shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
        {modelControl ? (
          <ProviderIcon
            kind={modelControl.currentAgentKind}
            {...(selectedProvider?.icon ? { icon: selectedProvider.icon } : {})}
            fallbackLabel={selectedProvider?.label}
            tone="active"
            className="size-3.5 shrink-0"
          />
        ) : (
          <Sparkles className="size-3.5 text-violet-300" />
        )}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top end" className="min-w-[260px] rounded-[14px]">
        <Dropdown.Menu aria-label="模型与运行参数">
          {effortControl && effortControl.contextSizes.length > 0 ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="context" textValue="上下文窗口大小">
                <Gauge className="size-4 text-muted" />
                <Label>上下文窗口大小</Label>
                <span className="ml-auto text-[10px] text-muted">{effortControl.contextValue}</span>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="min-w-[210px] rounded-[14px]">
                <div className="flex flex-col">
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
                <span className="ml-auto max-w-24 truncate text-[10px] text-muted">
                  {selectedModel?.label}
                </span>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="max-h-[420px] min-w-[250px] rounded-[14px]">
                <Dropdown.Menu aria-label="模型列表">
                  {modelControl.providers.flatMap((provider, providerIndex) =>
                    provider.capabilities.models.map((model) => {
                      const isCurrent =
                        provider.kind === modelControl.currentAgentKind &&
                        provider.accountId === modelControl.currentAccountId &&
                        model.id === modelControl.currentModel;
                      return (
                        <Dropdown.Item
                          key={`${providerIndex}:${provider.kind}:${model.id}`}
                          id={`${providerIndex}:${provider.kind}:${model.id}`}
                          textValue={`${provider.label} ${model.label}`}
                          onPress={() =>
                            modelControl.onChange({
                              agentKind: provider.kind,
                              model: model.id,
                              ...(provider.presentationMode
                                ? { presentationMode: provider.presentationMode }
                                : {}),
                              ...(provider.accountId ? { accountId: provider.accountId } : {}),
                            })
                          }
                        >
                          <ProviderIcon
                            kind={provider.kind}
                            {...(provider.icon ? { icon: provider.icon } : {})}
                            fallbackLabel={provider.label}
                            tone="active"
                            className="size-4 shrink-0"
                          />
                          <Label>{model.label}</Label>
                          <span className="ml-auto text-[10px] text-muted">{provider.label}</span>
                          {isCurrent ? <Check className="size-3.5 text-emerald-400" /> : null}
                        </Dropdown.Item>
                      );
                    }),
                  )}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : null}

          {effortControl && effortControl.efforts.length > 0 ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="effort" textValue="推理强度">
                <Sparkles className="size-4 text-muted" />
                <Label>推理强度</Label>
                <span className="ml-auto text-[10px] text-muted">{effortLabel}</span>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="min-w-[190px] rounded-[14px]">
                <Dropdown.Menu
                  aria-label="推理强度"
                  onAction={(key) => effortControl.onEffortChange?.(String(key))}
                >
                  {effortControl.efforts.map((effort) => (
                    <Dropdown.Item key={effort.id} id={effort.id} textValue={effort.label}>
                      <Label>{effort.label}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
