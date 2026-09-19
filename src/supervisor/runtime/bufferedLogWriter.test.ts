import { appendFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferedLogWriter } from "./bufferedLogWriter";

vi.mock("node:fs/promises", () => ({ appendFile: vi.fn<typeof appendFile>() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("BufferedLogWriter", () => {
  it("coalesces output and preserves independent file ordering", async () => {
    vi.useFakeTimers();
    vi.mocked(appendFile).mockResolvedValue(undefined);
    const writer = new BufferedLogWriter();
    writer.append("one", "你好");
    writer.append("one", "🙂");
    writer.append("two", "other");
    expect(appendFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    expect(appendFile).toHaveBeenCalledWith("one", "你好🙂", "utf8");
    expect(appendFile).toHaveBeenCalledWith("two", "other", "utf8");
    writer.append("one", "after idle");
    await writer.flush("one");
    expect(appendFile).toHaveBeenLastCalledWith("one", "after idle", "utf8");
  });

  it("flush waits for an in-flight write even when its pending buffer is empty", async () => {
    let release!: () => void;
    vi.mocked(appendFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const writer = new BufferedLogWriter();
    writer.append("slow", "first");
    const first = writer.flush("slow");
    await Promise.resolve();
    let settled = false;
    const second = writer.flush("slow").then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(settled).toBe(true);
  });

  it("batches arrivals during a slow write without an unbounded promise/write queue", async () => {
    let release!: () => void;
    vi.mocked(appendFile)
      .mockResolvedValue(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const writer = new BufferedLogWriter();
    writer.append("slow", "initial:");
    const writes = [writer.flush("slow")];
    await Promise.resolve();
    for (let index = 0; index < 500; index++) {
      writer.append("slow", `${index},`);
      writes.push(writer.flush("slow"));
    }
    release();
    await Promise.all(writes);
    expect(
      vi
        .mocked(appendFile)
        .mock.calls.map((call) => call[1])
        .join(""),
    ).toBe(`initial:${Array.from({ length: 500 }, (_, index) => `${index},`).join("")}`);
    expect(appendFile).toHaveBeenCalledTimes(2);
  });

  it("keeps best-effort failure recovery and drains dispose", async () => {
    vi.mocked(appendFile)
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValue(undefined);
    const writer = new BufferedLogWriter();
    writer.append("file", "attempt");
    await writer.flush("file");
    writer.append("file", "recovered");
    await writer.dispose();
    expect(appendFile).toHaveBeenLastCalledWith("file", "recovered", "utf8");
  });
});
