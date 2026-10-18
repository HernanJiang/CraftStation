import { describe, expect, it, vi } from "vitest";
import { requiresWslStartupConfirmation, usesWsl, WslStartupConsent } from "./wslStartup";

describe("WSL startup consent", () => {
  it("requires consent for explicit WSL and Windows Muse launches, not background detection", () => {
    const payload = { projectLocation: { kind: "wsl", distro: "Ubuntu" } };
    expect(requiresWslStartupConfirmation("startThread", payload)).toBe(true);
    expect(requiresWslStartupConfirmation("startShell", payload)).toBe(true);
    expect(
      requiresWslStartupConfirmation("craftAgent", {
        craftPlan: { runtimeBinding: { harnessKind: "muse" } },
      }),
    ).toBe(true);
    expect(requiresWslStartupConfirmation("getAgentStatuses", { wslDistros: ["Ubuntu"] })).toBe(
      false,
    );
    expect(requiresWslStartupConfirmation("watchProject", payload)).toBe(false);
    expect(
      requiresWslStartupConfirmation("startThread", {
        projectLocation: { kind: "windows", path: "D:/repo" },
        agentKind: "codex",
        prompt: "muse",
      }),
    ).toBe(false);
  });

  it("recognizes UNC folders and does not request local WSL for a remote host", () => {
    expect(requiresWslStartupConfirmation("pickFolder", "\\\\wsl.localhost\\Ubuntu\\home")).toBe(
      true,
    );
    expect(usesWsl({ parentPath: "\\\\wsl$\\Ubuntu\\home" })).toBe(true);
    expect(usesWsl({ location: { kind: "wsl", remoteServerId: "server-1" } })).toBe(false);
  });

  it("cancel never enables WSL and can be retried", async () => {
    const confirm = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const enable = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const consent = new WslStartupConsent(confirm);
    await expect(consent.ensure(enable)).rejects.toThrow("WSL_STARTUP_CANCELLED");
    expect(enable).not.toHaveBeenCalled();
    expect(consent.granted).toBe(false);
    await consent.ensure(enable);
    expect(consent.granted).toBe(true);
  });

  it("shares a confirmation and only grants after the supervisor accepts", async () => {
    let resolveConfirmation!: (accepted: boolean) => void;
    const confirm = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const enable = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const consent = new WslStartupConsent(confirm);
    const first = consent.ensure(enable);
    const second = consent.ensure(enable);
    expect(consent.granted).toBe(false);
    expect(enable).not.toHaveBeenCalled();
    resolveConfirmation(true);
    await Promise.all([first, second]);
    await consent.ensure(enable);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(new WslStartupConsent(confirm).granted).toBe(false);
  });

  it("does not remember failed authorization or approve when no dialog is available", async () => {
    const consent = new WslStartupConsent(async () => true);
    await expect(
      consent.ensure(async () => {
        throw new Error("Supervisor exited");
      }),
    ).rejects.toThrow("Supervisor exited");
    expect(consent.granted).toBe(false);
    const enable = vi.fn<() => Promise<void>>();
    await expect(new WslStartupConsent(undefined).ensure(enable)).rejects.toThrow(
      "WSL_STARTUP_CANCELLED",
    );
    expect(enable).not.toHaveBeenCalled();
  });
});
