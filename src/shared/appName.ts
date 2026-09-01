import { type CraftStationChannel, productNameFor } from "./channel";

export function getAppName(channel: CraftStationChannel, isDev: boolean): string {
  const base = productNameFor(channel);
  return isDev ? `${base} (dev)` : base;
}
