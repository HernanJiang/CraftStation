import { describe, expect, it, vi } from "vitest";
import {
  getMonacoRuntimeFailure,
  isMonacoRuntimeError,
  publishMonacoRuntimeFailure,
  subscribeToMonacoRuntimeFailure,
} from "./monacoFailureIsolation";

describe("monacoFailureIsolation", () => {
  it("recognizes only failures explicitly published by the Monaco runtime", () => {
    const unrelatedNetworkError = new DOMException("Worker script failed", "NetworkError");
    const monacoError = new Error("local Monaco worker failed");

    publishMonacoRuntimeFailure(monacoError, { phase: "worker", workerLabel: "typescript" });

    expect(isMonacoRuntimeError(monacoError)).toBe(true);
    expect(isMonacoRuntimeError(unrelatedNetworkError)).toBe(false);
    expect(isMonacoRuntimeError(new Error(monacoError.message))).toBe(false);
    expect(getMonacoRuntimeFailure()).toMatchObject({
      error: monacoError,
      phase: "worker",
      workerLabel: "typescript",
    });
  });

  it("recognizes Monaco's timer rethrow of a worker ErrorEvent without swallowing other network errors", () => {
    const workerEvent = new ErrorEvent("error", {
      message: "Failed to load Monaco editor.worker",
      filename: "file:///app.asar/dist/renderer/assets/editor.worker.js",
    });
    expect(workerEvent.error).toBeNull();

    publishMonacoRuntimeFailure(workerEvent, {
      phase: "worker",
      workerLabel: "editorWorkerService",
    });

    const stack = (workerEvent as ErrorEvent & { stack?: string }).stack;
    const rethrown = stack ? new Error(`${workerEvent.message}\n\n${stack}`) : workerEvent;
    expect(isMonacoRuntimeError(rethrown)).toBe(true);
    expect(isMonacoRuntimeError(workerEvent)).toBe(true);

    const original = new Error("typescript worker exploded");
    publishMonacoRuntimeFailure(original, { phase: "worker", workerLabel: "typescript" });
    const wrapped = new Error(`${original.message}\n\n${original.stack ?? ""}`);
    expect(isMonacoRuntimeError(wrapped)).toBe(true);
    expect(
      isMonacoRuntimeError(`Uncaught Error: ${original.message}\n\n${original.stack ?? ""}`),
    ).toBe(true);
    expect(isMonacoRuntimeError(`Uncaught Error: ${original.message}`)).toBe(false);
    expect(isMonacoRuntimeError(new DOMException("Worker script failed", "NetworkError"))).toBe(
      false,
    );
    expect(isMonacoRuntimeError(new Error("renderer bootstrap failed"))).toBe(false);
  });

  it("notifies editor-local subscribers when a runtime failure occurs", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeToMonacoRuntimeFailure(listener);

    publishMonacoRuntimeFailure(new Error("worker failed"), { phase: "worker" });
    unsubscribe();
    publishMonacoRuntimeFailure(new Error("worker failed again"), { phase: "worker" });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
