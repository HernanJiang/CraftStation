import { Dropdown, Label } from "@heroui/react";
import { Check, ChevronDown, Gauge, Sparkles, WandSparkles } from "lucide-react";
import { useLingui } from "@lingui/react/macro";

export type CraftMode = "auto" | "efficient" | "creative";

export function CraftModeSwitch(props: {
  value: CraftMode;
  onChange: (mode: CraftMode) => void;
}) {
  const { t } = useLingui();
  const modes = [
    {
      id: "auto",
      label: t`Auto mode`,
      description: t`Default model with its native Harness`,
      icon: Sparkles,
    },
    {
      id: "efficient",
      label: t`Efficient mode`,
      description: t`Minimal Harness mode preview`,
      icon: Gauge,
    },
    {
      id: "creative",
      label: t`Creative mode`,
      description: t`Customize Model and Harness ingredients`,
      icon: WandSparkles,
    },
  ] satisfies ReadonlyArray<{
    id: CraftMode;
    label: string;
    description: string;
    icon: typeof Sparkles;
  }>;
  const active = modes.find((candidate) => candidate.id === props.value) ?? modes[0]!;
  const ActiveIcon = active.icon;

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={t`CraftStation mode`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-[var(--row-hover)]"
      >
        <ActiveIcon className="size-3.5 text-neutral-300" />
        <span>{active.label}</span>
        <ChevronDown className="size-3 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top end" className="min-w-[240px] rounded-[14px]">
        <Dropdown.Menu
          aria-label={t`CraftStation mode`}
          selectionMode="single"
          selectedKeys={[props.value]}
          onAction={(key) => props.onChange(String(key) as CraftMode)}
        >
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Dropdown.Item key={mode.id} id={mode.id} textValue={mode.label}>
                <Icon className="size-4 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Label>{mode.label}</Label>
                  <span className="truncate text-[10px] text-muted">{mode.description}</span>
                </span>
                {mode.id === props.value ? <Check className="size-3.5 text-neutral-200" /> : null}
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
