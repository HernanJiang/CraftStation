import { startTransition, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Plus, Search } from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { normalizeTopShortcutOrder } from "@/shared/settings";
import { getTopShortcutPickerItems, useTopShortcuts, type TopShortcutEntry } from "./topShortcuts";

const MORE_BUTTON_WIDTH = 34;
const ADD_BUTTON_WIDTH = 34;

function ShortcutButton(props: {
  entry: TopShortcutEntry;
  registerRef: (id: string, element: HTMLButtonElement | null) => void;
}) {
  return (
    <ControlTooltip label={props.entry.label}>
      <button
        type="button"
        ref={(element) => props.registerRef(props.entry.id, element)}
        data-testid={`top-shortcut-${props.entry.id}`}
        className={`craftstation-titlebar-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-muted transition-all duration-150 hover:-translate-y-px hover:bg-[var(--row-hover)] hover:text-foreground active:translate-y-0 ${
          props.entry.isActive ? "bg-[var(--row-active)] text-foreground" : ""
        }`}
        onClick={() => startTransition(() => props.entry.onPress())}
      >
        {props.entry.icon}
        <span>{props.entry.label}</span>
      </button>
    </ControlTooltip>
  );
}

/**
 * User-configurable titlebar shortcuts: ordered pins resolved from shared
 * settings, an overflow "More" menu when the bar runs out of room, and the
 * "+" picker (search + toggle pins). Primary navigation (pull requests, plan,
 * work) lives outside this component and is never treated as a pin.
 */
export function TopShortcutBar() {
  const { t } = useLingui();
  const entries = useTopShortcuts();
  const savedOrder = useSharedSettings((s) => s.topShortcutOrder);
  const setTopShortcutOrder = useSharedSettings((s) => s.setTopShortcutOrder);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const navRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const pinnedIds = useMemo(() => new Set(normalizeTopShortcutOrder(savedOrder)), [savedOrder]);
  const pickerItems = getTopShortcutPickerItems(query, pinnedIds);

  const togglePin = (id: string) => {
    const order = normalizeTopShortcutOrder(savedOrder);
    setTopShortcutOrder(
      order.includes(id) ? order.filter((entry) => entry !== id) : [...order, id],
    );
  };

  const registerRef = (id: string, element: HTMLButtonElement | null) => {
    if (element) itemRefs.current.set(id, element);
    else itemRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // jsdom (and any unmeasurable host) reports no sizes: show everything
    // instead of clipping the whole bar behind the overflow menu.
    if (typeof ResizeObserver === "undefined" || nav.clientWidth === 0) {
      setVisibleCount(entries.length);
      return;
    }
    const compute = () => {
      const gap = 2;
      const widths = entries.map(
        (entry) => (itemRefs.current.get(entry.id)?.offsetWidth ?? 0) + gap,
      );
      const fits = (available: number) => {
        let used = 0;
        let count = 0;
        for (const width of widths) {
          if (used + width > available) break;
          used += width;
          count += 1;
        }
        return count;
      };
      // The "+" picker lives in this same row, immediately after the
      // shortcuts, so always reserve its width (plus the overflow button's
      // width when entries overflow).
      let count = fits(Math.max(0, nav.clientWidth - ADD_BUTTON_WIDTH));
      if (count < entries.length) {
        // Reserve room for the overflow button and recount.
        count = fits(Math.max(0, nav.clientWidth - ADD_BUTTON_WIDTH - MORE_BUTTON_WIDTH));
      }
      setVisibleCount(count);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [entries]);

  const visible = visibleCount === null ? entries : entries.slice(0, visibleCount);
  const overflowed = visibleCount === null ? [] : entries.slice(visibleCount);

  // The "+" picker is part of the left shortcut group — rendered inside the
  // same flex row, immediately after the visible shortcuts (and the overflow
  // menu when present), so it follows the group instead of sitting isolated
  // in the middle of the titlebar. Same h-7 sizing and hover style as the
  // other titlebar controls.
  return (
    <span ref={navRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      {visible.map((entry) => (
        <ShortcutButton key={entry.id} entry={entry} registerRef={registerRef} />
      ))}
      {overflowed.length > 0 ? (
        <Dropdown>
          <ControlTooltip label={t`More shortcuts`} detail={t`Hidden shortcuts`}>
            <Dropdown.Trigger
              aria-label={t`More shortcuts`}
              className="craftstation-titlebar-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-xs text-muted transition-all duration-150 hover:-translate-y-px hover:bg-[var(--row-hover)] hover:text-foreground active:translate-y-0"
            >
              <MoreHorizontal className="size-4" />
            </Dropdown.Trigger>
          </ControlTooltip>
          <Dropdown.Popover placement="bottom start" className="min-w-[220px] rounded-[14px]">
            <Dropdown.Menu aria-label={t`More shortcuts`}>
              {overflowed.map((entry) => (
                <Dropdown.Item
                  key={entry.id}
                  id={entry.id}
                  textValue={entry.label}
                  onPress={() => startTransition(() => entry.onPress())}
                >
                  {entry.icon}
                  <Label>{entry.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      ) : null}
      <Dropdown onOpenChange={(open) => !open && setQuery("")}>
        <ControlTooltip label={t`Customize shortcuts`} detail={t`Open more features`}>
          <Dropdown.Trigger
            aria-label={t`Customize shortcuts`}
            className="craftstation-titlebar-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-xs text-muted transition-all duration-150 hover:-translate-y-px hover:bg-[var(--row-hover)] hover:text-foreground active:translate-y-0"
          >
            <Plus className="size-4" />
          </Dropdown.Trigger>
        </ControlTooltip>
        <Dropdown.Popover placement="bottom start" className="min-w-[260px] rounded-[14px]">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-white/10 p-2">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                aria-label={t`Search settings`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t`Search settings`}
                className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
              />
            </div>
            <Dropdown.Menu
              aria-label={t`Customize shortcuts`}
              onAction={(key) => togglePin(String(key))}
            >
              {pickerItems.map((item) => (
                <Dropdown.Item key={item.id} id={item.id} textValue={`${item.label} ${item.id}`}>
                  {item.icon}
                  <Label>{item.label}</Label>
                  {item.pinned ? <Check className="ml-auto size-3.5 text-emerald-400" /> : null}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </div>
        </Dropdown.Popover>
      </Dropdown>
    </span>
  );
}
