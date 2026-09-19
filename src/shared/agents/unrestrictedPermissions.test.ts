import { describe, expect, it } from "vitest";
import {
  applyHomeScopePermissions,
  resolveUnrestrictedPermissionConfig,
} from "./unrestrictedPermissions";

describe("resolveUnrestrictedPermissionConfig", () => {
  it("prefers the provider's declared bypass posture over conventional ids (kimi auto over yolo)", () => {
    // kimi ≥0.42: `yolo` is only ask-when-needed, `auto` is the true never-ask.
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [
          { id: "default", label: "Default" },
          { id: "auto", label: "Auto Approve" },
          { id: "yolo", label: "Bypass Approvals" },
        ],
        sandboxModes: [],
        bypassPermissions: { approvalPolicy: "auto" },
      }),
    ).toEqual({ approvalPolicy: "auto" });
  });

  it("prefers the declared bypass posture even when a stronger-sounding id is advertised (claude)", () => {
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [
          { id: "default", label: "Default" },
          { id: "auto", label: "Auto mode" },
          { id: "acceptEdits", label: "Accept Edits" },
          { id: "dontAsk", label: "Don't Ask" },
          { id: "bypassPermissions", label: "Bypass Permissions" },
        ],
        sandboxModes: [],
        bypassPermissions: { approvalPolicy: "auto" },
      }),
    ).toEqual({ approvalPolicy: "auto" });
  });

  it("resolves approval and sandbox together when both are declared (codex)", () => {
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [
          { id: "untrusted", label: "Read Only" },
          { id: "on-request", label: "Ask for approval" },
          { id: "never", label: "Never" },
        ],
        sandboxModes: [
          { id: "read-only", label: "Read only" },
          { id: "workspace-write", label: "Workspace write" },
          { id: "danger-full-access", label: "Full access" },
        ],
        bypassPermissions: { approvalPolicy: "never", sandboxMode: "danger-full-access" },
      }),
    ).toEqual({ approvalPolicy: "never", sandboxMode: "danger-full-access" });
  });

  it("falls back to conventional ids when no bypass posture is declared", () => {
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [
          { id: "default", label: "Default" },
          { id: "yolo", label: "YOLO" },
        ],
        sandboxModes: [],
      }),
    ).toEqual({ approvalPolicy: "yolo" });
  });

  it("falls back to conventional ids when the declared bypass is not advertised", () => {
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [
          { id: "default", label: "Default" },
          { id: "never", label: "Never" },
        ],
        sandboxModes: [],
        bypassPermissions: { approvalPolicy: "auto-high" },
      }),
    ).toEqual({ approvalPolicy: "never" });
  });

  it("keeps a declared bypass when the probe advertises no choices", () => {
    expect(
      resolveUnrestrictedPermissionConfig({
        approvalPolicies: [],
        sandboxModes: [],
        bypassPermissions: { approvalPolicy: "auto" },
      }),
    ).toEqual({ approvalPolicy: "auto" });
  });

  it("returns nothing when nothing is known", () => {
    expect(resolveUnrestrictedPermissionConfig({ approvalPolicies: [], sandboxModes: [] })).toEqual(
      {},
    );
  });
});

describe("applyHomeScopePermissions", () => {
  const windowsHome = { kind: "windows" as const, path: "C:\\Users\\tester" };

  it("does not override the app default or explicit Ask choice in Home", () => {
    const config = { model: "test", approvalPolicy: "default" };
    expect(
      applyHomeScopePermissions(windowsHome, config, {
        approvalPolicies: [
          { id: "default", label: "Ask" },
          { id: "auto", label: "Full" },
        ],
        sandboxModes: [],
        bypassPermissions: { approvalPolicy: "auto" },
      }),
    ).toEqual(config);
  });

  it("maps a kimi-like declared bypass into home-scope configs", () => {
    expect(
      applyHomeScopePermissions(
        windowsHome,
        { model: "k3-256k" },
        {
          approvalPolicies: [
            { id: "default", label: "Default" },
            { id: "auto", label: "Auto Approve" },
            { id: "yolo", label: "Bypass Approvals" },
          ],
          sandboxModes: [],
          bypassPermissions: { approvalPolicy: "auto" },
        },
      ),
    ).toEqual({ model: "k3-256k", approvalPolicy: "auto" });
  });
});
