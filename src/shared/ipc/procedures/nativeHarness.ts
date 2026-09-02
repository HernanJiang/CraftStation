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
} as const;
