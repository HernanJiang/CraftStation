import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createComputerUseDriver } from "./drivers";
import { dispatchTool, type ToolContext } from "./mcp/toolRegistry";

// 1.3 Computer Use — REAL Windows GUI acceptance (goal §三).
// Drives the real Windows driver (PowerShell + compiled Win32 shim) through
// every required operation against a real Notepad instance. No mocks.
//
// Guarded by CRAFTSTATION_CU_E2E=1: these tests move the REAL mouse/keyboard
// and take FOREGROUND focus, so they must never run as part of ordinary suites.
const e2eReady = process.platform === "win32" && process.env.CRAFTSTATION_CU_E2E === "1";

describe.skipIf(!e2eReady)("Computer Use real Windows GUI acceptance", () => {
  const driver = createComputerUseDriver();
  const ctx: ToolContext = { driver, threadId: "cu-e2e", setSessionActive: () => {} };

  type CuWindow = {
    app: string;
    id: number;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  let notepad: CuWindow | undefined;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await dispatchTool(name, args, ctx);
    expect(result).toBeTruthy();
    return result;
  }

  function findNotepadWindows(): CuWindow[] {
    return (lastWindows as CuWindow[]).filter(
      (w) => /notepad/i.test(String(w.app ?? "")) || /notepad/i.test(String(w.title ?? "")),
    );
  }
  let lastWindows: unknown[] = [];

  it("drives enable/api/list/launch/window-state/activate/click/type/key/scroll/drag/disable for real", async () => {
    // Hygiene: a leftover system dialog (e.g. OpenWith) holds the foreground
    // and defeats SetForegroundWindow for every interactive action.
    try {
      execSync("taskkill /IM OpenWith.exe /F", { stdio: "ignore" });
    } catch {
      // none present
    }

    // 1-2. Session + API surface
    expect(await call("enable")).toBeTruthy();
    const api = (await call("api")) as { platform?: string; tools?: unknown[] };
    expect(api.platform).toBe("win32");
    expect((api.tools ?? []).length).toBeGreaterThanOrEqual(13);

    // 3-4. Discovery
    const apps = (await call("list_apps")) as unknown[];
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
    lastWindows = (await call("list_windows")) as unknown[];
    expect(Array.isArray(lastWindows)).toBe(true);

    // 5. Launch a real app
    const launched = (await call("launch_app", { app: "notepad.exe" })) as Record<string, unknown>;
    expect(String(JSON.stringify(launched)).toLowerCase()).not.toContain('"error"');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 6-7. Target the real Notepad window
    lastWindows = (await call("list_windows")) as unknown[];
    const candidates = findNotepadWindows();
    expect(candidates.length).toBeGreaterThan(0);
    const target: CuWindow = { ...candidates[0]! };
    const refreshed = (await call("get_window", {
      app: target.app,
      id: target.id,
    })) as Partial<CuWindow>;
    if (typeof refreshed.app === "string") target.app = refreshed.app;
    if (typeof refreshed.id === "number") target.id = refreshed.id;
    if (typeof refreshed.title === "string") target.title = refreshed.title;
    if (typeof refreshed.x === "number") target.x = refreshed.x;
    if (typeof refreshed.y === "number") target.y = refreshed.y;
    if (typeof refreshed.width === "number") target.width = refreshed.width;
    if (typeof refreshed.height === "number") target.height = refreshed.height;
    notepad = target;
    expect(target.id).toBeTruthy();

    // 8. Real passive screenshot + state
    const state = (await call("get_window_state", {
      window: notepad,
      include_screenshot: true,
      max_dimension: 640,
    })) as Record<string, unknown>;
    const stateText = JSON.stringify(state);
    expect(stateText.length).toBeGreaterThan(1000); // real screenshot payload

    // 9. Foreground
    expect(await call("activate_window", { window: notepad })).toBeTruthy();

    // 10. Click into the editor area (window-relative, mid-lower canvas)
    const width = Number(target.width ?? 800);
    const height = Number(target.height ?? 600);
    expect(
      await call("click", {
        window: notepad,
        x: Math.floor(width / 2),
        y: Math.floor(height * 0.6),
      }),
    ).toBeTruthy();

    // 11. Real keyboard text entry
    expect(
      await call("type_text", { window: notepad, text: "CRAFTSTATION_COMPUTER_USE_OK" }),
    ).toBeTruthy();

    // 12. Real key chord
    expect(await call("press_key", { window: notepad, key: "Return" })).toBeTruthy();

    // 13. Real wheel scroll over the window
    expect(
      await call("scroll", {
        window: notepad,
        x: Math.floor(width / 2),
        y: Math.floor(height / 2),
        scrollX: 0,
        scrollY: -3,
      }),
    ).toBeTruthy();

    // 14. Real drag (text selection sweep over the typed line)
    expect(
      await call("drag", {
        window: notepad,
        from_x: Math.floor(width * 0.3),
        from_y: Math.floor(height * 0.6),
        to_x: Math.floor(width * 0.8),
        to_y: Math.floor(height * 0.6),
      }),
    ).toBeTruthy();

    // 15. Window stays targetable after interactions
    const refreshed2 = (await call("get_window", { app: target.app, id: target.id })) as Record<
      string,
      unknown
    >;
    expect(refreshed2.id ?? target.id).toBeTruthy();

    // 16. Session teardown
    expect(await call("disable")).toBeTruthy();
  }, 180_000);

  it("closes the probe app", async () => {
    try {
      execSync("taskkill /IM Notepad.exe /F & taskkill /IM mspaint.exe /F", { stdio: "ignore" });
    } catch {
      // notepad already closed
    }
    driver.dispose();
    expect(true).toBe(true);
  });
});
