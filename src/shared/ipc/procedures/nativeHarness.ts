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
} as const;
