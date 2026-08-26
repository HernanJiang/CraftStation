import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "@heroui/react";

export function ControlTooltip(props: {
  children: ReactElement;
  label: ReactNode;
  shortcut?: string;
  detail?: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
  triggerClassName?: string;
}) {
  const {
    children,
    label,
    shortcut,
    detail,
    placement = "bottom",
    delay = 150,
    triggerClassName,
  } = props;

  return (
    <Tooltip delay={delay}>
      <Tooltip.Trigger
        tabIndex={-1}
        role="none"
        {...(triggerClassName ? { className: triggerClassName } : {})}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content
        placement={placement}
        offset={8}
        className="craftstation-control-tooltip pointer-events-none"
      >
        <span className="flex items-center gap-3 whitespace-nowrap">
          <span className="font-medium text-neutral-100">{label}</span>
          {shortcut ? (
            <kbd className="font-sans text-[11px] font-normal text-neutral-400">{shortcut}</kbd>
          ) : detail ? (
            <span className="text-[11px] text-neutral-400">{detail}</span>
          ) : null}
        </span>
      </Tooltip.Content>
    </Tooltip>
  );
}
