import { afterEach, describe, expect, it, vi } from "vitest";
import { getWslCommand } from "../agents/base/shellBasics";
import { allowWslStartup, isWslStartupAllowed, WSL_STARTUP_ALLOWED_ENV } from "./startupAccess";
import { WslBridgeServer, type WslBridgeServerOptions } from "./bridge";
import { resolveWslHostAccess } from "./hostAccess";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("WSL execution gate", () => {
  it("blocks commands, helper staging, and networking/UNC probes before consent", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv(WSL_STARTUP_ALLOWED_ENV, "0");
    const resolveNode = vi.fn<NonNullable<WslBridgeServerOptions["resolveNode"]>>();
    const deploy = vi.fn<NonNullable<WslBridgeServerOptions["deploy"]>>();
    const spawn = vi.fn<NonNullable<WslBridgeServerOptions["spawn"]>>();
    const bridge = new WslBridgeServer({
      onEvent: vi.fn<() => void>(),
      secret: "test",
      protocolVersion: 1,
      resolveNode,
      deploy,
      spawn,
    });
    expect(isWslStartupAllowed()).toBe(false);
    expect(() => getWslCommand()).toThrow("WSL_STARTUP_CONFIRMATION_REQUIRED");
    expect(await bridge.ensureBridge("Ubuntu")).toBeUndefined();
    expect(await resolveWslHostAccess("Ubuntu")).toBeUndefined();
    expect(resolveNode).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    allowWslStartup();
    expect(isWslStartupAllowed()).toBe(true);
    expect(getWslCommand()).toMatch(/wsl\.exe$/);
  });

  it("leaves non-Windows execution unchanged", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.stubEnv(WSL_STARTUP_ALLOWED_ENV, "0");
    expect(isWslStartupAllowed()).toBe(true);
  });
});
