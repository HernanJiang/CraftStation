const OPEN_CODE_PRIVATE_RUNTIME_ENVIRONMENT_KEYS = new Set([
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "OPENCODE_CONFIG_DIR",
]);

/** Environment keys that must be derived from the Supervisor-owned runtime root. */
export function isOpenCodePrivateRuntimeEnvironmentKey(key: string): boolean {
  return OPEN_CODE_PRIVATE_RUNTIME_ENVIRONMENT_KEYS.has(key.toUpperCase());
}
