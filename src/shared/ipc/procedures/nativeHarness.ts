import {
  nativeHarnessControlPlanePayloadSchema,
  type NativeHarnessControlPlaneEntry,
  type NativeHarnessControlPlanePayload,
} from "../../crafting/nativeHarness";
import {
  craftingModelInventoryPayloadSchema,
  type CraftingModelInventory,
  type CraftingModelInventoryPayload,
} from "../../crafting/modelInventory";
import {
  resolveCompatibilityPayloadSchema,
  type ResolveCompatibilityPayload,
  type ResolveCompatibilityResult,
} from "../../crafting/compatibility";
import {
  compatibilityBridgeControlPayloadSchema,
  type CompatibilityBridgeControlPayload,
  compatibilityBridgeStatusPayloadSchema,
  type CompatibilityBridgeStatusPayload,
  type CompatibilityBridgeStatusView,
} from "../../crafting/compatibilityBridge";
import { definePayloadProcedure } from "../core";

export const nativeHarnessProcedures = {
  /** Returns only the safe control-plane projection; runtime objects stay in Supervisor. */
  getNativeHarnessControlPlane: definePayloadProcedure<
    NativeHarnessControlPlanePayload,
    NativeHarnessControlPlaneEntry[],
    "supervisor"
  >("getNativeHarnessControlPlane", "supervisor", nativeHarnessControlPlanePayloadSchema),
  /** Official Codex app-server model/list projection for Crafting inventory. */
  getCraftingModelInventory: definePayloadProcedure<
    CraftingModelInventoryPayload,
    CraftingModelInventory,
    "supervisor"
  >("getCraftingModelInventory", "supervisor", craftingModelInventoryPayloadSchema),
  /**
   * Read-only preview of a Model × Harness combination. Computes a safe
   * CapabilityResolution from descriptor/status/profile/readiness. Never
   * launches a process, creates an Entity/Session or alters the user's
   * selection — it is the Workbench's compatibility gate.
   */
  resolveCraftingCompatibility: definePayloadProcedure<
    ResolveCompatibilityPayload,
    ResolveCompatibilityResult,
    "supervisor"
  >("resolveCraftingCompatibility", "supervisor", resolveCompatibilityPayloadSchema),
  /**
   * Secret-free Compatibility Bridge (CLIProxyAPI sidecar) status for the
   * Components inventory. Read-only; never starts the sidecar.
   */
  getCompatibilityBridgeStatus: definePayloadProcedure<
    CompatibilityBridgeStatusPayload,
    CompatibilityBridgeStatusView,
    "supervisor"
  >("getCompatibilityBridgeStatus", "supervisor", compatibilityBridgeStatusPayloadSchema),
  /**
   * One-click start for the CLIProxyAPI sidecar. Resolves the binary
   * (env → PATH → bundled sidecar folder) and awaits the authenticated
   * readiness probe; throws a remediation-carrying error when no binary is
   * found or the sidecar never becomes ready.
   */
  startCompatibilityBridge: definePayloadProcedure<
    CompatibilityBridgeControlPayload,
    CompatibilityBridgeStatusView,
    "supervisor"
  >("startCompatibilityBridge", "supervisor", compatibilityBridgeControlPayloadSchema),
  /** Idempotent stop for the CLIProxyAPI sidecar. */
  stopCompatibilityBridge: definePayloadProcedure<
    CompatibilityBridgeControlPayload,
    CompatibilityBridgeStatusView,
    "supervisor"
  >("stopCompatibilityBridge", "supervisor", compatibilityBridgeControlPayloadSchema),
  /**
   * Download the official CLIProxyAPI release into the user tools dir.
   * Does not start the sidecar; call start/ensure after install.
   */
  installCompatibilityBridge: definePayloadProcedure<
    CompatibilityBridgeControlPayload,
    CompatibilityBridgeStatusView,
    "supervisor"
  >("installCompatibilityBridge", "supervisor", compatibilityBridgeControlPayloadSchema),
  /**
   * Install the sidecar if missing, then start it. Used by 合成 and the
   * Components inventory so an idle or absent CPA is not a dead end.
   */
  ensureCompatibilityBridge: definePayloadProcedure<
    CompatibilityBridgeControlPayload,
    CompatibilityBridgeStatusView,
    "supervisor"
  >("ensureCompatibilityBridge", "supervisor", compatibilityBridgeControlPayloadSchema),
} as const;
