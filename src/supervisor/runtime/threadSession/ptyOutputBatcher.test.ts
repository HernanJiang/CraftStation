import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyOutputBatcher, PTY_OUTPUT_BATCH_MS } from "./ptyOutputBatcher";

describe("PtyOutputBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces appends inside the window into one concatenated delivery", () => {
    const deliver = vi.fn<(key: object, data: string) => void>();
    const key = {};
    const batcher = new PtyOutputBatcher<object>(deliver);

    batcher.append(key, "first");
    batcher.append(key, "second");
    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS - 1);
    expect(deliver).not.toHaveBeenCalled();

    batcher.append(key, "third");
    vi.advanceTimersByTime(1);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(key, "firstsecondthird");
  });

  it("delivers each key separately without mixing chunks", () => {
    const deliver = vi.fn<(key: object, data: string) => void>();
    const a = {};
    const b = {};
    const batcher = new PtyOutputBatcher<object>(deliver);

    batcher.append(a, "a1");
    batcher.append(b, "b1");
    batcher.append(a, "a2");
    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS);

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(a, "a1a2");
    expect(deliver).toHaveBeenCalledWith(b, "b1");
  });

  it("flushKey delivers one key immediately while others wait for the timer", () => {
    const deliver = vi.fn<(key: object, data: string) => void>();
    const a = {};
    const b = {};
    const batcher = new PtyOutputBatcher<object>(deliver);

    batcher.append(a, "a-data");
    batcher.append(b, "b-data");
    batcher.flushKey(a);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(a, "a-data");

    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(b, "b-data");
  });

  it("flushKey clears the shared timer when nothing remains pending", () => {
    const deliver = vi.fn<(key: object, data: string) => void>();
    const batcher = new PtyOutputBatcher<object>(deliver);
    const key = {};

    batcher.append(key, "only");
    batcher.flushKey(key);
    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS * 4);

    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("flush() delivers everything and a later tick delivers nothing more", () => {
    const deliver = vi.fn<(key: object, data: string) => void>();
    const a = {};
    const b = {};
    const batcher = new PtyOutputBatcher<object>(deliver);

    batcher.append(a, "a");
    batcher.append(b, "b");
    batcher.flush();

    expect(deliver).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS * 4);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering other keys when one deliver throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = {};
    const b = {};
    const seen: string[] = [];
    const batcher = new PtyOutputBatcher<object>((key, data) => {
      if (key === a) throw new Error("deliver exploded");
      seen.push(data);
    });

    batcher.append(a, "a");
    batcher.append(b, "b");
    vi.advanceTimersByTime(PTY_OUTPUT_BATCH_MS);

    expect(seen).toEqual(["b"]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("code=PTY_OUTPUT_DELIVER_FAILED"),
      expect.any(Error),
    );
  });
});
