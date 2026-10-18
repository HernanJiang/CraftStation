const INTERACTIVE_WSL_OPERATIONS = new Set([
  "enableWsl",
  "startThread",
  "craftAgent",
  "resumeCraftAgent",
  "startShell",
  "authenticateAcpAgent",
  "installAcpRegistryAgent",
  "updateAcpRegistryAgent",
  "updateAgentBinary",
  "installAgentHookPlugin",
  "pickFolder",
  "pickFiles",
  "createProjectDirectory",
  "revealProjectEntry",
  "openProjectEntryWithSystem",
]);

export function usesWsl(value: unknown): boolean {
  if (typeof value === "string") return /^\\\\wsl(?:\$|\.localhost)\\/i.test(value);
  if (!value || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  const record = value as Record<string, unknown>;
  if (record.remoteServerId) return false;
  if (record.kind === "wsl" || record.envKind === "wsl") return true;
  if (record.agentKind === "muse" || record.harnessKind === "muse") return true;
  return Object.entries(record).some(([key, child]) => {
    if (typeof child === "string" && /path|workspace/i.test(key)) {
      return /^\\\\wsl(?:\$|\.localhost)\\/i.test(child);
    }
    return typeof child === "object" && usesWsl(child);
  });
}

export const WSL_LOCAL_FILE_OPERATIONS = new Set([
  "pickFolder",
  "pickFiles",
  "createProjectDirectory",
  "detectProjectIcon",
  "listProjectIconFiles",
  "readLocalImageFile",
  "revealProjectEntry",
  "openProjectEntryWithSystem",
  "extractOfficeDocumentText",
]);

export function requiresWslStartupConfirmation(operation: string, payload: unknown): boolean {
  return (
    INTERACTIVE_WSL_OPERATIONS.has(operation) && (operation === "enableWsl" || usesWsl(payload))
  );
}

/** One confirmation per app run, shared by concurrent requests and crash restarts. */
export class WslStartupConsent {
  granted = false;
  private pending: Promise<void> | undefined;

  constructor(private readonly confirm: (() => Promise<boolean>) | undefined) {}

  async ensure(enable: () => Promise<void>): Promise<void> {
    if (this.granted) return;
    if (this.pending) return this.pending;
    const pending = (async () => {
      if (!(await this.confirm?.())) {
        console.info(
          "[craftstation] phase=wsl operation=startup-consent status=cancelled code=WSL_STARTUP_CANCELLED",
        );
        throw new Error("WSL_STARTUP_CANCELLED: 已取消启动 WSL。");
      }
      await enable();
      this.granted = true;
    })();
    this.pending = pending;
    try {
      await pending;
    } finally {
      this.pending = undefined;
    }
  }
}
