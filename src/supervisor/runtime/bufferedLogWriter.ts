import { appendFile } from "node:fs/promises";

interface BufferedEntry {
  buffer: string[];
  timer: ReturnType<typeof setTimeout> | null;
  writing: Promise<void> | null;
}

export class BufferedLogWriter {
  private readonly entries = new Map<string, BufferedEntry>();

  append(path: string, chunk: string): void {
    if (!chunk) {
      return;
    }
    let entry = this.entries.get(path);
    if (!entry) {
      entry = {
        buffer: [],
        timer: null,
        writing: null,
      };
      this.entries.set(path, entry);
    }

    entry.buffer.push(chunk);
    if (entry.timer || entry.writing) {
      return;
    }

    entry.timer = setTimeout(() => {
      void this.flush(path);
    }, 25);
  }

  flush(path: string): Promise<void> {
    const entry = this.entries.get(path);
    if (!entry) return Promise.resolve();

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    // 每个文件只有一个 drain。慢盘期间继续聚合新数据，避免为每个 flush
    // 留下 payload + Promise 链；flush 也必须等待已提交但尚未完成的写入。
    entry.writing ??= this.drain(path, entry).then(() => {
      entry.writing = null;
      // drain 完成与清理回调之间可能有追加；先检查再释放，不能丢该批输出。
      if (entry.buffer.length > 0) {
        return this.flush(path);
      } else {
        this.entries.delete(path);
      }
      return undefined;
    });
    return entry.writing;
  }

  private async drain(path: string, entry: BufferedEntry): Promise<void> {
    while (entry.buffer.length > 0) {
      const payload = entry.buffer.join("");
      entry.buffer = [];
      try {
        await appendFile(path, payload, "utf8");
      } catch {
        // best-effort dev logging
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((path) => this.flush(path)));
  }
}
