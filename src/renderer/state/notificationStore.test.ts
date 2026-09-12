import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NOTIFICATION_ITEMS, selectHasUnread, useNotificationStore } from "./notificationStore";

const push = (title: string, tone: "success" | "warning" | "danger" | "info" = "success") =>
  useNotificationStore.getState().push({ tone, title, status: "Done" });

describe("notificationStore", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockRestore();
    useNotificationStore.getState().clear();
  });

  it("pushes newest first and marks items unread", () => {
    push("first");
    push("second");

    const items = useNotificationStore.getState().items;
    expect(items.map((item) => item.title)).toEqual(["second", "first"]);
    expect(selectHasUnread(items)).toBe(true);
  });

  it("caps the list at the maximum size", () => {
    for (let index = 0; index < MAX_NOTIFICATION_ITEMS + 5; index += 1) {
      push(`task-${index}`);
    }

    const items = useNotificationStore.getState().items;
    expect(items).toHaveLength(MAX_NOTIFICATION_ITEMS);
    // Newest kept, oldest evicted.
    expect(items[0]!.title).toBe(`task-${MAX_NOTIFICATION_ITEMS + 4}`);
    expect(items.at(-1)!.title).toBe("task-5");
  });

  it("clears the unread dot while keeping the list for review", () => {
    push("first");
    push("second");

    useNotificationStore.getState().markAllRead();

    const items = useNotificationStore.getState().items;
    expect(items).toHaveLength(2);
    expect(selectHasUnread(items)).toBe(false);
    expect(items.every((item) => item.read)).toBe(true);

    // A new completion turns the dot back on.
    push("third");
    expect(selectHasUnread(useNotificationStore.getState().items)).toBe(true);
  });

  it("replaces an existing notification for the same thread instead of stacking", () => {
    useNotificationStore.getState().push({
      tone: "success",
      title: "first run",
      status: "Done",
      threadId: "thread-1",
    });
    useNotificationStore.getState().push({
      tone: "warning",
      title: "second run",
      status: "Needs Attention · Reply required",
      threadId: "thread-1",
    });
    useNotificationStore.getState().push({
      tone: "success",
      title: "other thread",
      status: "Done",
      threadId: "thread-2",
    });

    const items = useNotificationStore.getState().items;
    expect(items.map((item) => item.title)).toEqual(["other thread", "second run"]);
    expect(items.find((item) => item.threadId === "thread-1")?.status).toBe(
      "Needs Attention · Reply required",
    );
  });

  it("drops a thread's notifications when that conversation is opened", () => {
    useNotificationStore.getState().push({
      tone: "success",
      title: "first",
      status: "Done",
      threadId: "thread-1",
    });
    useNotificationStore.getState().push({
      tone: "warning",
      title: "second",
      status: "Needs Attention",
      threadId: "thread-2",
    });

    useNotificationStore.getState().dismissThread("thread-1");

    const items = useNotificationStore.getState().items;
    expect(items.map((item) => item.title)).toEqual(["second"]);
    expect(selectHasUnread(items)).toBe(true);

    useNotificationStore.getState().dismissThread("thread-2");
    expect(useNotificationStore.getState().items).toEqual([]);
    expect(selectHasUnread(useNotificationStore.getState().items)).toBe(false);
  });

  it("removes one item and clears everything", () => {
    push("first");
    push("second");
    const secondId = useNotificationStore.getState().items[0]!.id;

    useNotificationStore.getState().remove(secondId);
    expect(useNotificationStore.getState().items.map((item) => item.title)).toEqual(["first"]);

    useNotificationStore.getState().clear();
    expect(useNotificationStore.getState().items).toEqual([]);
    expect(selectHasUnread(useNotificationStore.getState().items)).toBe(false);
  });
});
