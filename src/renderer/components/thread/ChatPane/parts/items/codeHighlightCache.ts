/** 只缓存可重算的高亮 HTML，不裁剪原始代码或当前显示内容。 */
export class CodeHighlightCache {
  private readonly entries = new Map<string, { html: string; bytes: number }>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(maxBytes = 8 * 1024 * 1024, maxEntries = 200) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.html;
  }

  set(key: string, html: string): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    // 按 UTF-16 上界估算字符串内容；包含 key 内的原始代码。
    // 这是缓存文本预算，不是整个 JS heap 或字符串对象头的精确尺寸。
    const bytes = (key.length + html.length) * 2;
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest)!;
      this.bytes -= entry.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { html, bytes });
    this.bytes += bytes;
  }
}
