import { Dropdown, Label } from "@heroui/react";
import { ChevronDown, Cpu, Gauge, RotateCcw, Sparkles } from "lucide-react";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import type { ComposerControl } from "./ThreadComposer";

export function DraftParameterMenu(props: { controls: ComposerControl[] }) {
  const modelControl = props.controls.find((control) => control.kind === "provider-model");
  const effortControl = props.controls.find((control) => control.kind === "effort-context");
  const selectedProvider = modelControl?.providers.find(
    (provider) => provider.kind === modelControl.currentAgentKind,
  );
  const selectedModel = selectedProvider?.capabilities.models.find(
    (candidate) => candidate.id === modelControl?.currentModel,
  );
  const effortLabel = effortControl?.efforts.find(
    (candidate) => candidate.id === effortControl.effortValue,
  )?.label;
  // Agent detection may temporarily expose an empty model id. Keep the Codex-style
  // parameter capsule useful instead of collapsing to a sparkles-only button.
  const currentModelLabel = modelControl?.currentModel.trim();
  const label = [selectedModel?.label || currentModelLabel || "自定义", effortLabel]
    .filter(Boolean)
    .join(" · ");

  function reset() {
    const provider = modelControl?.providers[0];
    const model = provider?.capabilities.models[0];
    if (provider && model && modelControl) {
      modelControl.onChange({
        agentKind: provider.kind,
        model: model.id,
        ...(provider.presentationMode ? { presentationMode: provider.presentationMode } : {}),
      });
    }
    if (effortControl?.efforts[0]) effortControl.onEffortChange?.(effortControl.efforts[0].id);
    if (effortControl?.contextSizes[0]) {
      effortControl.onContextChange?.(effortControl.contextSizes[0].id);
    }
  }

  return (
    <Dropdown>
      <Dropdown.Trigger className="inline-flex h-9 max-w-[210px] shrink-0 items-center gap-1.5 rounded-xl bg-[var(--surface-secondary)] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
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
              <Dropdown.Popover className="min-w-[190px] rounded-[14px]">
                <Dropdown.Menu
                  aria-label="上下文窗口大小"
                  onAction={(key) => effortControl.onContextChange?.(String(key))}
                >
                  {effortControl.contextSizes.map((context) => (
                    <Dropdown.Item key={context.id} id={context.id} textValue={context.label}>
                      <Label>{context.label}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : null}

          {modelControl ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="models" textValue="模型列表">
                <Cpu className="size-4 text-muted" />
                <Label>模型列表</Label>
                <span className="ml-auto max-w-24 truncate text-[10px] text-muted">
                  {selectedModel?.label}
                </span>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="max-h-[420px] min-w-[250px] rounded-[14px]">
                <Dropdown.Menu
                  aria-label="模型列表"
                  onAction={(key) => {
                    const [agentKind, model] = String(key).split("::");
                    const provider = modelControl.providers.find(
                      (candidate) => candidate.kind === agentKind,
                    );
                    if (agentKind && model) {
                      modelControl.onChange({
                        agentKind,
                        model,
                        ...(provider?.presentationMode
                          ? { presentationMode: provider.presentationMode }
                          : {}),
                      });
                    }
                  }}
                >
                  {modelControl.providers.flatMap((provider) =>
                    provider.capabilities.models.map((model) => (
                      <Dropdown.Item
                        key={`${provider.kind}::${model.id}`}
                        id={`${provider.kind}::${model.id}`}
                        textValue={`${provider.label} ${model.label}`}
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
                      </Dropdown.Item>
                    )),
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

          <Dropdown.Item id="reset" textValue="重置为默认设置" onPress={reset}>
            <RotateCcw className="size-4 text-muted" />
            <Label>重置为默认设置</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
