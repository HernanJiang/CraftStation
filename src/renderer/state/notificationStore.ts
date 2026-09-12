import { create } from "zustand";

export type NotificationTone = "success" | "warning" | "danger" | "info";

/**
 * One compact notification row. `title` identifies the task, `status` is the
 * short completion/attention state shown on the same line, and `project` is
 * optional provenance shown in the bell list.
 */
export interface NotificationItem {
  id: string;
  tone: NotificationTone;
  title: string;
  status: string;
  project?: string;
  threadId?: string;
  createdAt: number;
  read: boolean;
}

interface NotificationStore {
  /** Newest first, capped at MAX_NOTIFICATION_ITEMS. */
  items: NotificationItem[];
  push: (input: {
    tone: NotificationTone;
    title: string;
    status: string;
    project?: string;
    threadId?: string;
  }) => void;
  /** Clears the unread dot; keeps the list for review. */
  markAllRead: () => void;
  /** Opening a conversation is viewing it: drop that thread's bell rows. */
  dismissThread: (threadId: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const MAX_NOTIFICATION_ITEMS = 30;

let sequence = 0;

export const useNotificationStore = create<NotificationStore>()((set) => ({
  items: [],
  push: (input) =>
    set((state) => {
      sequence += 1;
      const item: NotificationItem = {
        ...input,
        id: `notification-${Date.now()}-${sequence}`,
        createdAt: Date.now(),
        read: false,
      };
      // One row per thread: a later completion replaces the earlier one
      // instead of stacking duplicates in the bell list.
      const rest = input.threadId
        ? state.items.filter((existing) => existing.threadId !== input.threadId)
        : state.items;
      return { items: [item, ...rest].slice(0, MAX_NOTIFICATION_ITEMS) };
    }),
  markAllRead: () =>
    set((state) =>
      state.items.some((item) => !item.read)
        ? { items: state.items.map((item) => (item.read ? item : { ...item, read: true })) }
        : state,
    ),
  dismissThread: (threadId) =>
    set((state) => {
      if (!threadId || !state.items.some((item) => item.threadId === threadId)) return state;
      return { items: state.items.filter((item) => item.threadId !== threadId) };
    }),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set({ items: [] }),
}));

export function selectHasUnread(items: NotificationItem[]): boolean {
  return items.some((item) => !item.read);
}

export function selectThreadHasUnreadNotification(
  items: NotificationItem[],
  threadId: string,
): boolean {
  return items.some((item) => item.threadId === threadId && !item.read);
}
