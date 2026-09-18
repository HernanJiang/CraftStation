import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

const { sharedSettingsState, toastMock, bridgeMock, openThreadMock } = vi.hoisted(() => ({
  sharedSettingsState: {
    current: {
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    },
  },
  toastMock: {
    close: vi.fn<(key: string) => void>(),
    danger: vi.fn<(title: string, options: unknown) => void>(),
    info: vi.fn<(title: string, options: unknown) => void>(),
    success: vi.fn<(title: string, options: unknown) => void>(),
    warning: vi.fn<(title: string, options: unknown) => void>(),
  },
  bridgeMock: {
    focusWindow: vi.fn<() => Promise<void>>(),
    remote: false,
    showNotification: vi.fn<(payload: unknown) => Promise<boolean>>(),
  },
  openThreadMock: vi.fn<(threadId: string, options?: unknown) => void>(),
}));

vi.mock("@heroui/react", () => ({
  toast: toastMock,
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: openThreadMock,
}));

vi.mock("@/renderer/bridge", () => ({
  isRemoteSession: () => bridgeMock.remote,
  readBridge: () => bridgeMock,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      view: { kind: "home" },
      projects: [],
    }),
  },
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: {
    getState: () => sharedSettingsState.current,
  },
}));

import { useNotificationStore } from "@/renderer/state/notificationStore";
import {
  handleThreadStateNotification,
  shouldInspectThreadStateForNotification,
  showInAppUserNotification,
} from "./notifications";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

type FakeNotification = {
  title: string;
  options: NotificationOptions | undefined;
  onclick: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

function installBrowserNotification(permission: NotificationPermission = "granted") {
  const notifications: FakeNotification[] = [];
  class BrowserNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValue("granted");

    readonly title: string;
    readonly options: NotificationOptions | undefined;
    onclick: (() => void) | null = null;
    close = vi.fn<() => void>();

    constructor(title: string, options?: NotificationOptions) {
      this.title = title;
      this.options = options;
      notifications.push(this);
    }
  }
  vi.stubGlobal("Notification", BrowserNotification);
  return { BrowserNotification, notifications };
}

beforeEach(() => {
  useNotificationStore.getState().clear();
  bridgeMock.remote = false;
  bridgeMock.focusWindow.mockClear();
  bridgeMock.showNotification.mockClear();
  openThreadMock.mockClear();
  toastMock.danger.mockClear();
  toastMock.info.mockClear();
  toastMock.success.mockClear();
  toastMock.warning.mockClear();
  vi.unstubAllGlobals();
});

describe("showInAppUserNotification", () => {
  it("shows an Agent-requested notification as a compact in-app toast", () => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: false,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    toastMock.info.mockImplementationOnce(() => "toast-user" as never);

    showInAppUserNotification({
      threadId: "thread-1",
      title: "Done",
      body: "Ready for review",
    });

    expect(toastMock.info).toHaveBeenCalledWith("Done", {
      context: "Ready for review",
      onPress: expect.any(Function),
      timeout: 5000,
    });
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({
        tone: "info",
        title: "Done",
        status: "Ready for review",
        threadId: "thread-1",
        read: false,
      }),
    ]);
    expect(bridgeMock.showNotification).not.toHaveBeenCalled();
  });
});

describe("shouldInspectThreadStateForNotification", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    toastMock.danger.mockClear();
    toastMock.close.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
  });

  it("skips focused hot-path work for the default unfocused-only setting", () => {
    expect(shouldInspectThreadStateForNotification()).toBe(false);
  });

  it("keeps unfocused native notification checks enabled", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    expect(shouldInspectThreadStateForNotification()).toBe(true);
  });

  it("keeps focused checks when in-app notifications are enabled", () => {
    sharedSettingsState.current = {
      ...sharedSettingsState.current,
      notificationFilter: "all",
    };

    expect(shouldInspectThreadStateForNotification()).toBe(true);
  });

  it("skips checks when every notification category is disabled", () => {
    sharedSettingsState.current = {
      ...sharedSettingsState.current,
      notificationStatuses: { done: false, needsAttention: false, error: false },
    };

    expect(shouldInspectThreadStateForNotification()).toBe(false);
  });
});

describe("handleThreadStateNotification", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: false,
      notificationFilter: "all",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    toastMock.danger.mockClear();
    toastMock.success.mockClear();
    toastMock.warning.mockClear();
  });

  it("does not notify for attention-only updates when status is unchanged", () => {
    const oldThread = thread({ status: "idle", attention: "none" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "idle",
        attention: "needs_reply",
      },
      oldThread,
      { status: "idle", attention: "needs_reply" },
    );

    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.danger).not.toHaveBeenCalled();
  });

  it("uses the actual stored next status for done notifications", () => {
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "idle",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(toastMock.success).toHaveBeenCalledWith("Thread", {
      context: "Finished · Waiting for your input",
      ledgerLogged: true,
      onPress: expect.any(Function),
      timeout: 5000,
    });
  });
});

describe("handleThreadStateNotification unfocused path", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: false,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    bridgeMock.remote = false;
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    bridgeMock.showNotification.mockClear();
    bridgeMock.showNotification.mockResolvedValue(true);
  });

  it("shows a compact in-app toast without calling the OS notification bridge", () => {
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "finished",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(toastMock.success).toHaveBeenCalledWith("Thread", {
      context: "Finished · Waiting for your input",
      ledgerLogged: true,
      onPress: expect.any(Function),
      timeout: 5000,
    });
    expect(bridgeMock.showNotification).not.toHaveBeenCalled();
  });

  it("does not depend on native notification IPC", () => {
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "finished",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(toastMock.success).toHaveBeenCalledOnce();
    expect(bridgeMock.showNotification).not.toHaveBeenCalled();
  });

  it("closes the oldest task notification when a fourth one arrives", () => {
    toastMock.success.mockImplementationOnce(() => "toast-1" as never);
    toastMock.success.mockImplementationOnce(() => "toast-2" as never);
    toastMock.success.mockImplementationOnce(() => "toast-3" as never);
    toastMock.success.mockImplementationOnce(() => "toast-4" as never);

    for (let index = 0; index < 4; index += 1) {
      const oldThread = thread({
        id: `thread-${index}`,
        status: "working",
        attention: "working",
      });
      handleThreadStateNotification(
        {
          type: "thread-state",
          threadId: oldThread.id,
          status: "finished",
          attention: "none",
        },
        oldThread,
        { status: "finished", attention: "none" },
      );
    }

    expect(toastMock.close).toHaveBeenCalledWith("toast-1");
  });
});

describe("handleThreadStateNotification PWA path", () => {
  beforeEach(() => {
    sharedSettingsState.current = {
      notificationsEnabled: true,
      notificationSound: false,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
    };
    bridgeMock.remote = true;
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    bridgeMock.showNotification.mockClear();
  });

  it("uses the same in-app toast instead of a browser or desktop notification", () => {
    const { notifications } = installBrowserNotification();
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "finished",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(bridgeMock.showNotification).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
    expect(toastMock.success).toHaveBeenCalledWith("Thread", {
      context: "Finished · Waiting for your input",
      ledgerLogged: true,
      onPress: expect.any(Function),
      timeout: 5000,
    });
  });

  it("does not notify when a desktop stop or steer force-closes the active turn", () => {
    const { notifications } = installBrowserNotification();
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "idle",
        attention: "none",
        forceCloseActiveTurn: true,
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(notifications).toHaveLength(0);
    expect(bridgeMock.showNotification).not.toHaveBeenCalled();
  });

  it("does not request browser notification permission", () => {
    const { BrowserNotification, notifications } = installBrowserNotification("default");
    const oldThread = thread({ status: "working", attention: "working" });

    handleThreadStateNotification(
      {
        type: "thread-state",
        threadId: oldThread.id,
        status: "finished",
        attention: "none",
      },
      oldThread,
      { status: "finished", attention: "none" },
    );

    expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(0);
    expect(toastMock.success).toHaveBeenCalledOnce();
  });
});
