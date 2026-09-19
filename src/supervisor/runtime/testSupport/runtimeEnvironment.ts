import { vi } from "vitest";

/** 单元/协议夹具只使用显式注入的内建 MCP，避免继承宿主真实服务与 token。 */
export function isolateRuntimeMcpEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (/^CRAFTSTATION_.*MCP_(?:URL|TOKEN)$/.test(key)) vi.stubEnv(key, undefined);
  }
}
