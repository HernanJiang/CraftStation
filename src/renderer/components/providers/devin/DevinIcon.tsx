import { createProviderIcon } from "../common/createProviderIcon";

/** Geometric hexagon mark for Cognition Devin (no licensed raster vendored). */
const DEVIN_PATH =
  "M12 2.15 20.4 7v10L12 21.85 3.6 17V7L12 2.15Zm0 3.2L6.7 8.25v7.5L12 18.65l5.3-2.9V8.25L12 5.35Z";

export const DevinIcon = createProviderIcon({
  cssPrefix: "craftstation-devin-icon",
  path: DEVIN_PATH,
  viewBox: "0 0 24 24",
  fillRule: "evenodd",
});
