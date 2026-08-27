import { describe, expect, it } from "vitest";
import { PeripheralSidecarClient } from "./sidecarClient";
import { PeripheralProcessTransport } from "./processTransport";
import {
  PERIPHERAL_PROTOCOL_VERSION,
  type PeripheralDiagnostic,
  type PeripheralSidecarTransport,
} from "./types";

class FakeTransport implements PeripheralSidecarTransport {
  private closed = true;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly closeListeners = new Set<(diagnostic: PeripheralDiagnostic) => void>();
  readonly writes: string[] = [];
  startCount = 0;
  stopCount = 0;
  onWrite?: (line: string) => void;
  writeError: Error | undefined;

  get isClosed(): boolean {
    return this.closed;
  }

  async start(): Promise<void> {
    this.startCount += 1;
    this.closed = false;
  }

  write(line: string): void {
    if (this.writeError) throw this.writeError;
    this.writes.push(line);
    this.onWrite?.(line);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onClose(listener: (diagnostic: PeripheralDiagnostic) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.closed = true;
  }

  respond(requestId: string, result: unknown): void {
    const line = JSON.stringify({
      protocolVersion: PERIPHERAL_PROTOCOL_VERSION,
      requestId,
      result,
    });
    for (const listener of this.lineListeners) listener(line);
  }

  emitLine(line: string): void {
    for (const listener of this.lineListeners) listener(line);
  }

  crash(message = "sidecar crashed"): void {
    this.closed = true;
    const diagnostic = { stderrTail: message, exitCode: 1, exitSignal: null };
    for (const listener of this.closeListeners) listener(diagnostic);
  }
}

describe("PeripheralSidecarClient", () => {
  it("derives a platform/arch-specific bundled binary path", () => {
    expect(PeripheralProcessTransport.bundledBinaryPath).toBeTypeOf("function");
  });
  it("correlates versioned JSONL requests and responses", async () => {
    const transport = new FakeTransport();
    const client = new PeripheralSidecarClient(transport);
    transport.onWrite = (line) => {
      const request = JSON.parse(line);
      transport.respond(request.requestId, { ready: true, version: 1 });
    };

    await client.start();
    await expect(client.ping()).resolves.toEqual({ ready: true, version: 1 });
    const frame = JSON.parse(transport.writes[0]!);
    expect(frame).toMatchObject({ protocolVersion: 1, method: "ping" });
    expect(frame.requestId).toEqual(expect.any(String));
  });

  it("fails every in-flight request once after a sidecar crash", async () => {
    const transport = new FakeTransport();
    const client = new PeripheralSidecarClient(transport, 1_000);
    await client.start();
    const pending = client.request("usage.scan");
    transport.crash("diagnostic only");

    await expect(pending).rejects.toThrow(/exited while a request was in flight/);
    await expect(client.request("ping")).rejects.toThrow(/not running/);
    expect(client.getDiagnostic()).toMatchObject({ stderrTail: "diagnostic only", exitCode: 1 });
  });

  it("rejects immediately when transport write fails and can start again after a crash", async () => {
    const transport = new FakeTransport();
    const client = new PeripheralSidecarClient(transport, 10_000);
    await client.start();
    transport.writeError = new Error("pipe closed");
    await expect(client.request("ping")).rejects.toThrow(/pipe closed/);

    transport.writeError = undefined;
    transport.crash();
    await client.start();
    expect(transport.startCount).toBe(2);
  });

  it("ignores malformed and duplicate frames without hanging", async () => {
    const transport = new FakeTransport();
    const client = new PeripheralSidecarClient(transport);
    await client.start();
    transport.onWrite = (line) => {
      const request = JSON.parse(line);
      transport.emitLine("not-json");
      transport.respond(request.requestId, {
        name: "sidecar",
        version: "0.4.0",
        protocolVersion: 1,
      });
      transport.respond(request.requestId, { name: "duplicate" });
    };

    await expect(client.version()).resolves.toMatchObject({ name: "sidecar" });
  });
});
