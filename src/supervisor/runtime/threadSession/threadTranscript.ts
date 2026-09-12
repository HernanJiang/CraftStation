import type { RuntimeEvent } from "@/shared/contracts";

/**
 * Rolling per-thread transcript for pool-failover context carry-over.
 *
 * When a pool account dies mid-thread and the conversation rebuilds on the
 * next account, the new credential home cannot read the old session's
 * history (per-account isolated stores). The renderer still shows everything,
 * but the model would start blank. This tracker keeps a small text-only
 * tail (user prompts + assistant replies) from the canonical runtime events
 * the supervisor already routes, so failover can prepend it as a "前情提要"
 * to the replayed turn.
 *
 * Budget: at most MAX_ENTRIES entries and MAX_CHARS characters per thread
 * (≈ a few thousand tokens) — a failover is rare, but the replayed turn
 * pays for every character. Sub-agent rows (parentItemId) are excluded so
 * child chatter never pollutes the main-thread context. Terminal (PTY)
 * threads emit no canonical message events and simply yield no transcript.
 */

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

const MAX_TRANSCRIPT_ENTRIES = 20;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_ENTRY_CHARS = 1500;

function contentBlocksText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let hasAttachment = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const kind = (block as { kind?: unknown }).kind;
    if (kind === "text" && typeof (block as { text?: unknown }).text === "string") {
      parts.push((block as { text: string }).text);
    } else if (kind === "image" || kind === "file" || kind === "audio") {
      hasAttachment = true;
    }
  }
  const text = parts.join("\n").trim();
  if (text) return text;
  return hasAttachment ? "[附件]" : "";
}

function truncateEntry(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_ENTRY_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_ENTRY_CHARS)}…`;
}

export class ThreadTranscriptTracker {
  private readonly entries = new Map<string, TranscriptEntry[]>();
  private readonly entryChars = new Map<string, number>();
  private readonly truncated = new Map<string, boolean>();
  private readonly seenUserItems = new Map<string, Set<string>>();
  private readonly parentedItems = new Map<string, Set<string>>();
  private readonly pendingAssistant = new Map<string, string>();

  observe(threadId: string, event: RuntimeEvent): void {
    switch (event.type) {
      case "item.started": {
        if (event.parentItemId) {
          let parented = this.parentedItems.get(threadId);
          if (!parented) {
            parented = new Set();
            this.parentedItems.set(threadId, parented);
          }
          parented.add(event.itemId);
          return;
        }
        if (event.itemType !== "user_message") return;
        const payload = event.payload as { content?: unknown } | undefined;
        const text = truncateEntry(contentBlocksText(payload?.content));
        if (!text) return;
        let seen = this.seenUserItems.get(threadId);
        if (!seen) {
          seen = new Set();
          this.seenUserItems.set(threadId, seen);
        }
        // The optimistic paint and the session paint share one item id —
        // record the prompt once.
        if (seen.has(event.itemId)) return;
        seen.add(event.itemId);
        this.push(threadId, { role: "user", text });
        return;
      }
      case "content.delta": {
        if (event.stream !== "assistant_text") return;
        if (!event.delta) return;
        if (this.parentedItems.get(threadId)?.has(event.itemId)) return;
        const key = `${threadId}:${event.itemId}`;
        this.pendingAssistant.set(key, (this.pendingAssistant.get(key) ?? "") + event.delta);
        return;
      }
      case "item.completed": {
        this.parentedItems.get(threadId)?.delete(event.itemId);
        // seenUserItems is intentionally NOT pruned here: a failover replay
        // repaints the same user-message id on the new session, and it must
        // not record the prompt twice. The set is dropped with the thread.
        const key = `${threadId}:${event.itemId}`;
        const text = this.pendingAssistant.get(key);
        this.pendingAssistant.delete(key);
        if (text?.trim()) {
          this.push(threadId, { role: "assistant", text: truncateEntry(text) });
        }
        return;
      }
      case "turn.completed": {
        // Flush deltas stranded by interrupted turns (no item.completed).
        for (const [key, text] of [...this.pendingAssistant]) {
          if (!key.startsWith(`${threadId}:`)) continue;
          this.pendingAssistant.delete(key);
          const itemId = key.slice(threadId.length + 1);
          this.parentedItems.get(threadId)?.delete(itemId);
          if (text.trim()) this.push(threadId, { role: "assistant", text: truncateEntry(text) });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Copy of the retained tail (oldest first), for preface building. */
  take(threadId: string): TranscriptEntry[] {
    return [...(this.entries.get(threadId) ?? [])];
  }

  /** Whether anything was dropped for this thread (drives the omission note). */
  wasTruncated(threadId: string): boolean {
    return this.truncated.get(threadId) === true;
  }

  /** Drop everything (manager dispose). */
  clear(): void {
    this.entries.clear();
    this.entryChars.clear();
    this.truncated.clear();
    this.seenUserItems.clear();
    this.parentedItems.clear();
    this.pendingAssistant.clear();
  }

  /** Drop all state for a thread (removal/dispose). */
  drop(threadId: string): void {
    this.entries.delete(threadId);
    this.entryChars.delete(threadId);
    this.truncated.delete(threadId);
    this.seenUserItems.delete(threadId);
    this.parentedItems.delete(threadId);
    for (const key of [...this.pendingAssistant.keys()]) {
      if (key.startsWith(`${threadId}:`)) this.pendingAssistant.delete(key);
    }
  }

  private push(threadId: string, entry: TranscriptEntry): void {
    let list = this.entries.get(threadId);
    if (!list) {
      list = [];
      this.entries.set(threadId, list);
      this.entryChars.set(threadId, 0);
    }
    list.push(entry);
    this.entryChars.set(threadId, (this.entryChars.get(threadId) ?? 0) + entry.text.length);
    while (
      list.length > MAX_TRANSCRIPT_ENTRIES ||
      (this.entryChars.get(threadId) ?? 0) > MAX_TRANSCRIPT_CHARS
    ) {
      const dropped = list.shift();
      if (!dropped) break;
      this.entryChars.set(threadId, (this.entryChars.get(threadId) ?? 0) - dropped.text.length);
      this.truncated.set(threadId, true);
    }
  }
}

/**
 * Render the failover context preface. The replayed user prompt is NOT part
 * of the preface (it is sent right after); a trailing user entry duplicating
 * it is dropped so the model does not see the same question twice.
 */
export function buildHistoryPreface(
  entries: readonly TranscriptEntry[],
  currentPrompt: string,
  truncated: boolean,
): string | undefined {
  let tail = [...entries];
  const last = tail[tail.length - 1];
  if (
    last?.role === "user" &&
    (last.text === currentPrompt ||
      currentPrompt.startsWith(last.text) ||
      currentPrompt.length === 0)
  ) {
    tail = tail.slice(0, -1);
  }
  if (tail.length === 0) return undefined;
  const lines = tail.map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`);
  return [
    "[系统前情提要：本线程上一个账号的额度已耗尽，已自动切换到当前账号继续。以下是本线程此前的对话记录（仅作上下文，不要重复回答已经回答过的问题）：",
    "",
    ...lines,
    ...(truncated ? ["（……更早的消息已省略）"] : []),
    "",
    "以上是历史记录。下面是用户当前的问题，请基于以上上下文继续作答：]",
  ].join("\n");
}
