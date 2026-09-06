import { useEffect, useState, useRef } from "react";
import { Button } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { isHomeProject } from "@/shared/homeScope";
import { loadHomeScopeLocation } from "@/renderer/actions/projectActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  isWelcomeSeen,
  useWelcomeGateStore,
  WELCOME_SEEN_STORAGE_KEY,
} from "@/renderer/state/welcomeGateStore";
import { writeStoredBoolean } from "@/renderer/utils/localStorage";
import { BrandWordmark } from "@/renderer/components/common/BrandWordmark";
import { WELCOME_BACKGROUND_CODE } from "./welcomeBackgroundCode";
import appIconUrl from "../../../build/icon.png";

// Orbit + reveal animations finish ~2.4s after the overlay mounts. After
// that the comet has scaled to 0 and no longer needs its center sampled, so
// the rAF loop driving `--comet-x/y` can stop.
const ORBIT_DURATION_MS = 2400;

// `--comet-x/y` are the centers of a full-viewport background gradient
// (`.craftstation-welcome-bg-glow`) AND a mask over the glyph-heavy code wall
// (`.craftstation-welcome-code-wall`). Neither `background-position` nor
// `mask-image` is compositor-animatable, so each write re-rasterizes the
// viewport on the main thread. Writing them on every display refresh
// (~120fps on high-refresh panels) is what drops frames — the diffuse glow
// only needs a handful of updates per second. Gate the write to the shared
// ~20fps cadence (matches `thinkingAnimator.ts` TICK_MS) so the frame
// pipeline idles between ticks instead of stalling on per-frame repaints.
const COMET_LIGHT_TICK_MS = 50; // ~20fps

// Hold deferred first-launch background work (agent detection) until the
// cinematic intro has settled, so cold process spawns don't starve the first
// paint. A user who clicks a CTA sooner releases the gate immediately.
const WELCOME_SETTLE_MS = 3200;

declare global {
  interface Window {
    __craftstationRemoveBootSplash?: () => void;
  }
}

export function WelcomeOverlay(props: { ready?: boolean } = {}) {
  const ready = props.ready ?? true;
  const containerRef = useRef<HTMLDivElement>(null);
  const cometRef = useRef<HTMLSpanElement>(null);
  const mouseRafRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);

  const homeScopeEnabled = useSharedSettings((state) => state.homeScopeEnabled);
  const setHomeScopeEnabled = useSharedSettings((state) => state.setHomeScopeEnabled);
  const openDraft = useAppStore((state) => state.openDraft);

  // `welcomeSeen` is resolved synchronously from localStorage (or the dev-only
  // manual-test bypass) so the overlay's open state is known on the very first
  // render — no async settings gate, so the main UI never paints uncovered
  // behind the overlay on first launch.
  const [welcomeSeen, setWelcomeSeen] = useState(isWelcomeSeen);
  const open = !welcomeSeen;
  const [mounted, setMounted] = useState(open);
  // Initialize `visible` to `open` so the overlay is fully opaque on first
  // paint — the inner reveal/orbit animations are driven by CSS keyframes,
  // not by toggling `visible`, so we don't need a RAF flip on entry.
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    window.__craftstationRemoveBootSplash?.();
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(true);
      return;
    }
    setVisible(false);
  }, [open]);

  // First launch only: defer heavy background work until the intro animation
  // has settled, then release the gate so MainView can start agent detection.
  useEffect(() => {
    if (!open) return;
    const releaseTimer = window.setTimeout(() => {
      useWelcomeGateStore.getState().releaseBackgroundWork();
    }, WELCOME_SETTLE_MS);
    return () => clearTimeout(releaseTimer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    // Honor reduced motion: the comet is hidden by CSS in this mode, so leave
    // the glow parked at its off-screen default rather than sampling it.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const container = containerRef.current;
    const comet = cometRef.current;
    if (!container || !comet) return;
    // `fixed inset-0` => the container's box origin is stable for the orbit's
    // lifetime, so sample it once (as the mousemove handler already caches its
    // rect) instead of forcing a synchronous layout read every frame.
    const containerRect = container.getBoundingClientRect();
    let rafId = 0;
    let stopped = false;
    // NEGATIVE_INFINITY so the first frame writes immediately — no one-frame
    // gap where the glow sits at its off-screen default.
    let lastWriteAt = Number.NEGATIVE_INFINITY;
    const updateCometLight = (now: number) => {
      if (stopped) return;
      // Throttle the expensive (non-compositable) write to ~20fps; skipped
      // frames cost only a timestamp compare + reschedule.
      if (now - lastWriteAt >= COMET_LIGHT_TICK_MS) {
        lastWriteAt = now;
        const cometRect = comet.getBoundingClientRect();
        const cx = cometRect.left + cometRect.width / 2 - containerRect.left;
        const cy = cometRect.top + cometRect.height / 2 - containerRect.top;
        container.style.setProperty("--comet-x", `${cx}px`);
        container.style.setProperty("--comet-y", `${cy}px`);
      }
      rafId = requestAnimationFrame(updateCometLight);
    };
    rafId = requestAnimationFrame(updateCometLight);
    const stopTimer = window.setTimeout(() => {
      stopped = true;
      cancelAnimationFrame(rafId);
    }, ORBIT_DURATION_MS);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      clearTimeout(stopTimer);
    };
  }, [mounted]);

  function handleTransitionEnd(e: React.TransitionEvent) {
    if (e.target === e.currentTarget && !visible) {
      setMounted(false);
    }
  }

  function dismissWelcome() {
    writeStoredBoolean(WELCOME_SEEN_STORAGE_KEY, true);
    setWelcomeSeen(true);
    // The user is moving on — let deferred startup work (agent detection) run
    // now rather than waiting out the settle timer.
    useWelcomeGateStore.getState().releaseBackgroundWork();
  }

  function handleAskQuestion() {
    if (!homeScopeEnabled) {
      setHomeScopeEnabled(true);
    }
    dismissWelcome();

    const existingHomeProject = useAppStore.getState().projects.find(isHomeProject);
    if (existingHomeProject) {
      openDraft(existingHomeProject.id);
      return;
    }

    void loadHomeScopeLocation()
      .then((location) => {
        const project = useAppStore.getState().ensureHomeProject(location);
        openDraft(project.id);
      })
      .catch(() => {
        useAppStore.getState().openHome();
      });
  }

  if (!mounted) return null;

  const loading = open && !ready;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const spinning = open && loading && !reducedMotion;
  const actionsVisible = ready;

  return (
    <div
      ref={containerRef}
      className={`craftstation-welcome-page fixed inset-0 z-50 flex flex-col bg-background transition-opacity ${
        visible ? "opacity-100 duration-150" : "opacity-0 duration-500"
      }`}
      data-welcome-loading={loading ? "true" : "false"}
      data-welcome-spinning={spinning ? "true" : "false"}
      onTransitionEnd={handleTransitionEnd}
      onMouseMove={(e) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
        if (mouseRafRef.current !== null) return;
        mouseRafRef.current = requestAnimationFrame(() => {
          mouseRafRef.current = null;
          const container = containerRef.current;
          const pos = mousePosRef.current;
          if (!container || !pos) return;
          // Cache rect across frames; only the document scroll or resize
          // invalidates it, and either re-fires mousemove afterward.
          if (!containerRectRef.current) {
            containerRectRef.current = container.getBoundingClientRect();
          }
          const rect = containerRectRef.current;
          container.style.setProperty("--mouse-x", `${pos.x - rect.left}px`);
          container.style.setProperty("--mouse-y", `${pos.y - rect.top}px`);
        });
      }}
      onMouseLeave={() => {
        containerRectRef.current = null;
        if (mouseRafRef.current !== null) {
          cancelAnimationFrame(mouseRafRef.current);
          mouseRafRef.current = null;
        }
      }}
    >
      <div className="craftstation-welcome-bg-glow absolute inset-0 z-0 pointer-events-none" />
      <pre
        className="craftstation-welcome-code-wall absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-50 p-8 m-0"
        aria-hidden="true"
      >
        {WELCOME_BACKGROUND_CODE}
      </pre>

      <div
        className="craftstation-overlay-header relative z-10 flex shrink-0 items-center px-2"
        style={{ height: "env(titlebar-area-height, 32px)" }}
      />

      <div className="relative z-10 flex flex-1 items-center justify-center px-6">
        <div className="craftstation-welcome-stage flex w-full max-w-[680px] flex-col items-center gap-8 text-center">
          <div className="craftstation-welcome-icon-wrap relative flex size-24 items-center justify-center">
            <span className="craftstation-welcome-light absolute inset-[-18px] rounded-none" />
            <span className="craftstation-welcome-splash absolute inset-[-26px] rounded-none" />
            <span className="craftstation-welcome-orbit absolute inset-[-12px] rounded-none">
              <span
                ref={cometRef}
                className="craftstation-welcome-comet absolute left-1/2 top-0 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
              />
            </span>
            <div
              className={`craftstation-welcome-logo-spin absolute inset-0 flex items-center justify-center${
                spinning ? " craftstation-welcome-icon-spinning" : ""
              }`}
            >
              <span className="craftstation-welcome-ring absolute inset-[5px] rounded-none" />
              <span className="craftstation-welcome-reveal craftstation-welcome-icon-glass absolute inset-2 rounded-none" />
              <img
                src={appIconUrl}
                alt=""
                draggable={false}
                className="craftstation-welcome-reveal relative size-20 rounded-none"
              />
            </div>
          </div>

          <div
            className={`craftstation-welcome-reveal craftstation-welcome-reveal-1 flex flex-col items-center gap-3 transition-all duration-700 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <h1 className="flex items-baseline gap-3 overflow-visible pr-[0.22em] pb-[0.2em] text-[clamp(3.25rem,8vw,6.25rem)] leading-[1.28] font-semibold tracking-normal">
              <BrandWordmark className="inline-block pr-[0.04em] pb-[0.12em]" />
            </h1>
          </div>

          {actionsVisible ? (
            <div className="flex w-full max-w-[460px] flex-col items-center gap-4">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              <Button
                fullWidth
                size="lg"
                variant="tertiary"
                className="craftstation-welcome-button h-12 justify-center gap-2 !text-white"
                onPress={handleAskQuestion}
              >
                <Trans>Start</Trans>
              </Button>
            </div>
          ) : (
            <p
              className="craftstation-welcome-loading-label text-sm text-muted"
              data-testid="welcome-loading-status"
            >
              <Trans>Starting up</Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
