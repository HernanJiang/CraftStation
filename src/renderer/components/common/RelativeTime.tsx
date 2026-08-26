import { useEffect, useRef } from "react";
import { formatRelativeTime } from "@/renderer/utils/formatTime";

interface Registration {
  node: HTMLSpanElement;
  iso: string;
  lastText: string;
}

const registrations = new Set<Registration>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 0;

const MINUTE = 60_000;
const HOUR = 3_600_000;

function tickAll() {
  for (const reg of registrations) {
    const next = formatRelativeTime(reg.iso);
    if (next !== reg.lastText) {
      reg.node.textContent = next;
      reg.lastText = next;
    }
  }
  adjustInterval();
}

function adjustInterval() {
  let needsMinute = false;
  for (const reg of registrations) {
    if (Date.now() - new Date(reg.iso).getTime() < HOUR) {
      needsMinute = true;
      break;
    }
  }
  const desiredMs = needsMinute ? MINUTE : HOUR;
  if (desiredMs !== currentIntervalMs) {
    if (intervalId !== null) clearInterval(intervalId);
    currentIntervalMs = desiredMs;
    intervalId = setInterval(tickAll, desiredMs);
  }
}

function clockRegister(node: HTMLSpanElement, iso: string): Registration {
  const initial = formatRelativeTime(iso);
  const reg: Registration = { node, iso, lastText: initial };
  node.textContent = initial;
  registrations.add(reg);
  if (intervalId === null) {
    currentIntervalMs = MINUTE;
    intervalId = setInterval(tickAll, MINUTE);
  } else {
    adjustInterval();
  }
  return reg;
}

function clockUnregister(reg: Registration) {
  registrations.delete(reg);
  if (registrations.size === 0) {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    currentIntervalMs = 0;
  } else {
    adjustInterval();
  }
}

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const regRef = useRef<Registration | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const initial = formatRelativeTime(iso);
    node.textContent = initial;

    if (regRef.current) {
      regRef.current.iso = iso;
      regRef.current.lastText = initial;
      adjustInterval();
    } else {
      regRef.current = clockRegister(node, iso);
    }

    return () => {
      if (regRef.current) {
        clockUnregister(regRef.current);
        regRef.current = null;
      }
    };
  }, [iso]);

  return <span ref={ref} className={className} />;
}
