import {
  nativeHarnessControlPlanePayloadSchema,
  type NativeHarnessControlPlaneEntry,
  type NativeHarnessControlPlanePayload,
} from "../../crafting/nativeHarness";
import { definePayloadProcedure } from "../core";

export const nativeHarnessProcedures = {
  /** Returns only the safe control-plane projection; runtime objects stay in Supervisor. */
  getNativeHarnessControlPlane: definePayloadProcedure<
    NativeHarnessControlPlanePayload,
    NativeHarnessControlPlaneEntry[],
    "supervisor"
  >(
    "getNativeHarnessControlPlane",
    "supervisor",
    nativeHarnessControlPlanePayloadSchema,
  ),
} as const;
