import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { probeRendererContentHealth } from "./rendererHealth";

function createWindowHarness(executeJavaScript: ReturnType<typeof vi.fn>) {
  return {
    isDestroyed: vi.fn<() => boolean>(() => false),
    webContents: {
      isDestroyed: vi.fn<() => boolean>(() => false),
      isCrashed: vi.fn<() => boolean>(() => false),
      executeJavaScript,
    },
  } as unknown as BrowserWindow;
}

describe("probeRendererContentHealth", () => {
  it("reports healthy when React mounted and the boot splash left", async () => {
    const execute = vi.fn<() => Promise<unknown>>().mockResolvedValue({
      rootChildren: 3,
      bootSplash: false,
    });
    const health = await probeRendererContentHealth(createWindowHarness(execute));
    expect(health).toBe("healthy");
  });

  it("reports stuck when the boot splash is still the only content", async () => {
    const execute = vi.fn<() => Promise<unknown>>().mockResolvedValue({
      rootChildren: 0,
      bootSplash: true,
    });
    const health = await probeRendererContentHealth(createWindowHarness(execute));
    expect(health).toBe("stuck");
  });

  it("reports dead when script execution throws (crashed renderer)", async () => {
    const execute = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("render frame gone"));
    const health = await probeRendererContentHealth(createWindowHarness(execute));
    expect(health).toBe("dead");
  });

  it("reports dead when the renderer crashed before execution", async () => {
    const harness = createWindowHarness(vi.fn());
    (harness.webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true;
    const health = await probeRendererContentHealth(harness);
    expect(health).toBe("dead");
  });

  it("reports dead when the renderer never answers within the timeout", async () => {
    const execute = vi.fn<() => Promise<unknown>>().mockReturnValue(new Promise(() => {}));
    const health = await probeRendererContentHealth(createWindowHarness(execute), {
      timeoutMs: 30,
    });
    expect(health).toBe("dead");
  });
});
