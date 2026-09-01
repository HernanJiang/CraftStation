export type CraftStationChannel = "stable" | "nightly";

export const CRAFTSTATION_CHANNELS: readonly CraftStationChannel[] = ["stable", "nightly"];

declare const __CRAFTSTATION_CHANNEL__: string | undefined;

export function normalizeChannel(value: unknown): CraftStationChannel {
  return value === "nightly" ? "nightly" : "stable";
}

export function resolveCraftStationChannel(): CraftStationChannel {
  return normalizeChannel(
    typeof __CRAFTSTATION_CHANNEL__ === "string" ? __CRAFTSTATION_CHANNEL__ : "",
  );
}

export function productNameFor(channel: CraftStationChannel): string {
  return channel === "nightly" ? "CraftStation Nightly" : "CraftStation";
}

export function appIdFor(channel: CraftStationChannel): string {
  // Keep the pre-rebrand install identity so CraftStation upgrades the existing
  // CraftStation app and retains OS-owned credentials, permissions, and metadata.
  return channel === "nightly" ? "com.craftstation.app.nightly" : "com.craftstation.app";
}

export function userDataDirNameFor(channel: CraftStationChannel): string {
  return channel === "nightly" ? ".craftstation-nightly" : ".craftstation";
}

export function updaterChannelFor(channel: CraftStationChannel): string | undefined {
  return channel === "nightly" ? "nightly" : undefined;
}

export function artifactPrefixFor(channel: CraftStationChannel): string {
  return channel === "nightly" ? "CraftStation-Nightly" : "CraftStation";
}
