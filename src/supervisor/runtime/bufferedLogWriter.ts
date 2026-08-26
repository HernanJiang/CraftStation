import { appendFile } from "node:fs/promises";

interface BufferedEntry {
  buffer: string[];
  timer: ReturnType<typeof setTimeout> | null;
  writeChain: Promise<void>;
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
        writeChain: Promise.resolve(),
      };
      this.entries.set(path, entry);
    }

    entry.buffer.push(chunk);
    if (entry.timer) {
      return;
    }

    entry.timer = setTimeout(() => {
      void this.flush(path);
    }, 25);
  }

  async flush(path: string): Promise<void> {
    const entry = this.entries.get(path);
    if (!entry || entry.buffer.length === 0) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    const payload = entry.buffer.join("");
    entry.buffer = [];
    entry.writeChain = entry.writeChain.then(async () => {
      try {
        await appendFile(path, payload, "utf8");
      } catch {
        // best-effort dev logging
      }
    });
    await entry.writeChain;
  }

  dispose(): void {
    for (const [path] of this.entries) {
      void this.flush(path);
    }
  }
}
