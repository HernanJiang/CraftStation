import { createProviderIcon } from "../common/createProviderIcon";

// StepFun "step" mark rendered as a left-to-right ascending staircase on the
// shared 800×800 provider grid (same silhouette band as the Pi icon).
const STEP_CODE_PATH = "M165.29 634.72V517.36H282.65V400H400V282.65H517.36V165.29H634.72V634.72Z";

export const StepCodeIcon = createProviderIcon({
  cssPrefix: "craftstation-stepcode-icon",
  path: STEP_CODE_PATH,
  viewBox: "0 0 800 800",
});
