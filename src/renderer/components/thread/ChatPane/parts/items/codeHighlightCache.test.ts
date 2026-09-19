import { describe, expect, it } from "vitest";
import { CodeHighlightCache } from "./codeHighlightCache";

describe("code highlight cache budget", () => {
  it("accounts for source keys and Unicode HTML, evicting least recently used entries", () => {
    const cache = new CodeHighlightCache(28, 200);
    cache.set("a", "你好🙂"); // 10 conservative UTF-16 bytes
    cache.set("b", "1234");
    expect(cache.get("a")).toBe("你好🙂");
    cache.set("c", "5678");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("你好🙂");
    expect(cache.get("c")).toBe("5678");
  });
  it("does not retain an oversized entry or evict useful small entries for it", () => {
    const cache = new CodeHighlightCache(20);
    cache.set("small", "ok");
    cache.set("oversized source", "full HTML output");
    expect(cache.get("oversized source")).toBeUndefined();
    expect(cache.get("small")).toBe("ok");
  });
  it("replaces budgets correctly and keeps the count limit and theme isolation", () => {
    const cache = new CodeHighlightCache(1000, 2);
    cache.set("dark:json:code", "old");
    cache.set("dark:json:code", "new");
    cache.set("light:json:code", "light");
    expect(cache.get("dark:json:code")).toBe("new");
    cache.set("dark:typescript:code", "typescript");
    expect(cache.get("light:json:code")).toBeUndefined();
    expect(cache.get("dark:json:code")).toBe("new");
  });
});
