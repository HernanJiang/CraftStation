import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeMode } from "@/shared/contracts";

const settingsState: {
  themeMode: ThemeMode;
  themePreset: string;
  sidebarGlassTint: { light: number | null; dark: number | null };
} = {
  themeMode: "system",
  themePreset: "default",
  sidebarGlassTint: { light: null, dark: null },
};

vi.mock("../../state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => false,
  readBridge: () => ({
    setWindowChrome: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}));

import { AppProvider } from "./provider";
import { useNotificationStore } from "@/renderer/state/notificationStore";

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? prefersDark : !prefersDark,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  settingsState.themeMode = "system";
  settingsState.themePreset = "default";
  document.documentElement.classList.remove("light", "dark");
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreset;
  setMatchMedia(true);
});

afterEach(() => {
  toast.clear();
  useNotificationStore.getState().clear();
  // Restore the testSetup default matchMedia stub so other tests behave.
  setMatchMedia(true);
});

describe("AppProvider", () => {
  it("renders children", () => {
    render(
      <AppProvider>
        <div>provider works</div>
      </AppProvider>,
    );
    expect(screen.getByText("provider works")).toBeInTheDocument();
  });

  it("uses a compact top-left toast region", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast("Width test");
    });

    await waitFor(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      expect(region).toHaveClass("lc-toast-region");
      expect(region).toHaveStyle({
        "--toast-width": "min(20rem, calc(100vw - 1rem))",
      });
      expect(region).toHaveClass("toast-region--top-start");
    });
  });

  it("marks long toast descriptions as a bounded scrolling region", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast("Bounded toast", {
        description: Array.from({ length: 100 }, (_, index) => `Description line ${index}`).join(
          "\n",
        ),
        timeout: 0,
      });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-slot="toast-description"]')).toHaveClass(
        "lc-toast__description",
      );
      expect(document.querySelector('[data-slot="toast"]')).toHaveClass("lc-toast");
    });
  });

  it.each([
    ["down", { clientX: 100, clientY: 170 }],
    ["left", { clientX: 30, clientY: 100 }],
    ["right", { clientX: 170, clientY: 100 }],
  ])("dismisses a toast with a touch swipe %s", async (_direction, end) => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    act(() => {
      toast("Swipe test", { timeout: 0 });
    });

    const toastElement = await screen
      .findByText("Swipe test")
      .then((title) => title.closest('[data-slot="toast"]'));
    expect(toastElement).not.toBeNull();
    Object.defineProperty(toastElement, "setPointerCapture", {
      value: vi.fn<(pointerId: number) => void>(),
    });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, { pointerId: 1, pointerType: "touch", ...end });
    fireEvent.pointerUp(toastElement!, { pointerId: 1, pointerType: "touch", ...end });

    await waitFor(() => {
      expect(screen.queryByText("Swipe test")).not.toBeInTheDocument();
    });
  });

  it("keeps a toast for upward, short, and mouse drags", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    act(() => {
      toast("Keep test", { timeout: 0 });
    });

    const toastElement = await screen
      .findByText("Keep test")
      .then((title) => title.closest('[data-slot="toast"]'));
    expect(toastElement).not.toBeNull();
    Object.defineProperty(toastElement, "setPointerCapture", {
      value: vi.fn<(pointerId: number) => void>(),
    });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 20,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 1, pointerType: "touch" });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 140,
      clientY: 140,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 2, pointerType: "touch" });

    fireEvent.pointerDown(toastElement!, {
      pointerId: 3,
      pointerType: "mouse",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(toastElement!, {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(toastElement!, { pointerId: 3, pointerType: "mouse" });

    expect(screen.getByText("Keep test")).toBeInTheDocument();
  });

  it("shows error toast titles in full instead of truncating them", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    const message = "无法打开 executor_*.md：File not found: D:/work/executor_a1.md";
    act(() => {
      toast.danger(message, { timeout: 0 });
    });

    const title = await screen.findByText(message);
    expect(title).not.toHaveClass("truncate");
    expect(title).toHaveClass("whitespace-pre-wrap");
    expect(title).toHaveClass("break-words");
  });

  it("accumulates error toasts in the notification store", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast.danger("无法打开 EXPERIMENT_REGISTRY.md：File not found", { timeout: 0 });
      toast("Plain info toast", { timeout: 0 });
    });

    await waitFor(() => {
      const items = useNotificationStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        tone: "danger",
        title: "无法打开 EXPERIMENT_REGISTRY.md：File not found",
      });
    });
  });

  it("skips toasts that already logged their own bell row", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    act(() => {
      toast.danger("Thread failed", { timeout: 0, ledgerLogged: true } as any);
    });

    await screen.findByText("Thread failed");
    // Thread-state notifications push their own row in notifications.ts; the
    // generic ledger must not duplicate it.
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("forwards context and onPress through the toast queue", async () => {
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );

    const onPress = vi.fn<() => void>();
    act(() => {
      toast.success("Thread done", {
        context: "Finished · Waiting for your input",
        onPress,
        ledgerLogged: true,
        timeout: 0,
      } as any);
    });

    // HeroUI 3.2.2 used to silently drop these options; the app-shell
    // forwarding patch must keep them reachable for the provider.
    await screen.findByText("Finished · Waiting for your input");
    fireEvent.click(screen.getByText("Thread done"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("applies dark class + data-theme when themeMode is explicit 'dark'", () => {
    settingsState.themeMode = "dark";
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreset).toBe("default");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("applies light class + data-theme when themeMode is explicit 'light'", () => {
    settingsState.themeMode = "light";
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the system preference when themeMode is 'system' (dark)", () => {
    settingsState.themeMode = "system";
    setMatchMedia(true);
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the system preference when themeMode is 'system' (light)", () => {
    settingsState.themeMode = "system";
    setMatchMedia(false);
    render(
      <AppProvider>
        <span />
      </AppProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
