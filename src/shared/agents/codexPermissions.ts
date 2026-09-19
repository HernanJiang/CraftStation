/** Pure wire conversion shared by the owned runtime and isolated legacy adapter. */
export function toCodexSandboxPolicy(
  mode: string | undefined,
): { type: "readOnly" } | { type: "workspaceWrite" } | { type: "dangerFullAccess" } | undefined {
  switch (mode) {
    case "read-only":
      return { type: "readOnly" };
    case "workspace-write":
      return { type: "workspaceWrite" };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    default:
      return undefined;
  }
}
