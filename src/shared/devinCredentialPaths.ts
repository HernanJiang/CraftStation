import { homedir } from "node:os";
import { join } from "node:path";

/** Shared by credential discovery and explicit logout, so fallback files cannot resurrect a login. */
export function nativeDevinCredentialPaths(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    return [
      ...(appData ? [join(appData, "devin", "credentials.toml")] : []),
      join(home, ".devin", "credentials.toml"),
    ];
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const linux = join(xdg || join(home, ".local", "share"), "devin", "credentials.toml");
  const legacy = join(home, ".devin", "credentials.toml");
  return process.platform === "darwin"
    ? [join(home, "Library", "Application Support", "devin", "credentials.toml"), linux, legacy]
    : [linux, legacy];
}
