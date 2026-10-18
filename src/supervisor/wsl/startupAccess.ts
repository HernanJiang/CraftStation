/** The desktop sets this for each supervisor lifetime; consent is never persisted. */
export const WSL_STARTUP_ALLOWED_ENV = "CRAFTSTATION_WSL_STARTUP_ALLOWED";

export function isWslStartupAllowed(): boolean {
  // Unconfigured library consumers retain their existing behavior. Every
  // production SupervisorRuntime configures the gate before starting services.
  return process.platform !== "win32" || process.env[WSL_STARTUP_ALLOWED_ENV] !== "0";
}

export function assertWslStartupAllowed(): void {
  if (!isWslStartupAllowed()) {
    throw new Error("WSL_STARTUP_CONFIRMATION_REQUIRED: 请先确认允许 CraftStation 启动 WSL。");
  }
}

export function allowWslStartup(): void {
  process.env[WSL_STARTUP_ALLOWED_ENV] = "1";
  console.log(
    "[supervisor] phase=wsl operation=startup-consent status=allowed code=WSL_STARTUP_ALLOWED",
  );
}
