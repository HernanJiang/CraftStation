import type {
  NativeEventEnvelope,
  NativeHarnessDiagnostic,
  SessionSnapshot,
} from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";

type SnapshotState = Omit<SessionSnapshot, "events" | "nativeEvents" | "diagnostics">;

interface HistoryChunk<T> {
  readonly start: number;
  readonly previous: HistoryChunk<T> | undefined;
  readonly values: T[];
}

const CHUNK_SIZE = 128;

/** 有界尾块 + 只指向过去的链。旧快照不能保活创建后追加的所有历史。 */
class AppendOnlyHistory<T> {
  private readonly chunks: HistoryChunk<T>[] = [];
  length = 0;

  append(value: T): void {
    let tail = this.chunks.at(-1);
    if (!tail || tail.values.length === CHUNK_SIZE) {
      tail = { start: this.length, previous: tail, values: [] };
      this.chunks.push(tail);
    }
    tail.values.push(value);
    this.length++;
  }

  some(predicate: (value: T) => boolean): boolean {
    return this.chunks.some((chunk) => chunk.values.some(predicate));
  }

  readSince(index: number): T[] {
    const start = Math.min(this.length, Math.max(0, index < 0 ? this.length + index : index));
    return readPrefix(this.chunks.at(-1), start, this.length);
  }

  reader(): () => T[] {
    // 不捕获 this：链只包含创建时的前缀；未读快照最多额外保留同一尾块 127 项。
    let tail = this.chunks.at(-1);
    const length = this.length;
    let materialized: T[] | undefined;
    return () => {
      if (!materialized) {
        materialized = readPrefix(tail, 0, length);
        tail = undefined;
      }
      return materialized;
    };
  }
}

function readPrefix<T>(tail: HistoryChunk<T> | undefined, start: number, end: number): T[] {
  const parts: T[][] = [];
  for (
    let chunk = tail;
    chunk && chunk.start + chunk.values.length > start;
    chunk = chunk.previous
  ) {
    const from = Math.max(start, chunk.start);
    const to = Math.min(end, chunk.start + chunk.values.length);
    parts.push(
      from === chunk.start && to === chunk.start + chunk.values.length
        ? chunk.values
        : chunk.values.slice(from - chunk.start, to - chunk.start),
    );
  }
  parts.reverse();
  // 常规历史用引擎的 packed-array 复制，避免每次全量读取都执行逐元素 JS 循环。
  // 极长历史避免可变参数超过引擎限制，仍保留全部事件。
  if (parts.length <= 1024) return ([] as T[]).concat(...parts);
  const result = new Array<T>(end - start);
  let offset = 0;
  for (const part of parts) for (const value of part) result[offset++] = value;
  return result;
}

/**
 * 只负责 Session 的追加历史和时点快照，不参与 Harness 的执行或事件解释。
 * 广播通常只消费增量事件；按需复制历史，避免每个 token 都复制整个会话。
 */
export class SessionEventHistory {
  private readonly events = new AppendOnlyHistory<RuntimeEvent>();
  private readonly nativeEvents = new AppendOnlyHistory<NativeEventEnvelope>();
  private readonly diagnostics = new AppendOnlyHistory<NativeHarnessDiagnostic>();

  get eventCount(): number {
    return this.events.length;
  }

  append(event: RuntimeEvent): void {
    this.events.append(event);
    if (event.nativeEnvelope) this.nativeEvents.append(event.nativeEnvelope);
  }

  addDiagnostic(diagnostic: NativeHarnessDiagnostic): void {
    this.diagnostics.append(diagnostic);
  }

  eventsSince(index: number): RuntimeEvent[] {
    return this.events.readSince(index);
  }

  hasEvent(predicate: (event: RuntimeEvent) => boolean): boolean {
    return this.events.some(predicate);
  }

  readDiagnostics(): NativeHarnessDiagnostic[] {
    return this.diagnostics.readSince(0);
  }

  snapshot(state: SnapshotState): SessionSnapshot {
    // 必须在创建时记录三个长度，稍后读取旧快照也不能混入新事件/诊断。
    // 存储只追加、不截断；每份快照保留独立浅拷贝，兼容既有序列化和数组接口。
    const events = this.events.reader();
    const nativeEvents = this.nativeEvents.reader();
    const diagnostics = this.diagnostics.reader();
    return {
      ...state,
      get events() {
        return events();
      },
      get nativeEvents() {
        return nativeEvents();
      },
      get diagnostics() {
        return diagnostics();
      },
    };
  }
}
