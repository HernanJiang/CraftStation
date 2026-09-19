import { z } from "zod";
import {
  capabilityResolutionSchema,
  type CapabilityResolution,
  type HarnessReference,
  type SelectedModelEntry,
} from "./workbenchTypes";
import { resolveExecutionRoute, type ExecutionRouteReasonCode } from "./executionRoute";

/**
 * Pure, deterministic Model × Harness compatibility resolution.
 *
 * This is the shared seam behind the `resolveCraftingCompatibility` IPC. It
 * takes the user's chosen Model material and Harness material plus a safe
 * readiness projection, and returns a `CapabilityResolution` keyed to the
 * combination. It never launches a process, creates an Entity/Session or
 * changes the user's selection.
 */

export const resolveCompatibilityPayloadSchema = z.object({
  modelEntryRef: z.string().min(1),
  harnessRef: z.string().min(1),
  providerProfileRef: z.string().optional(),
  runtimeProfileRef: z.string().optional(),
});
export type ResolveCompatibilityPayload = z.infer<typeof resolveCompatibilityPayloadSchema>;

export const resolveCompatibilityResultSchema = capabilityResolutionSchema;
export type ResolveCompatibilityResult = CapabilityResolution;

/** A safe readiness projection provided by the Supervisor side of the seam. */
export interface CompatibilityReadinessInput {
  modelEntry: SelectedModelEntry | undefined;
  harnessRef: HarnessReference | undefined;
  /** Whether the harness is installed + authenticated + runtime ready. */
  harnessReady: boolean;
  /** OpenCode-specific route readiness; only meaningful when harnessKind === "opencode". */
  openCodeRouteReady?: boolean;
  /** Compatibility bridge service readiness */
  compatibilityBridgeReady?: boolean;
  /** A stable adapter id/version selected for this combination. */
  adapterId?: string;
  adapterVersion?: string;
  /** Capability entries the harness declares for this model surface. */
  capabilities?: Array<{
    name: string;
    state: "available" | "missing" | "degraded" | "unknown";
    source: "native-harness" | "compatibility-layer" | "fallback-harness" | "unavailable";
    reason?: string;
  }>;
}

/** Derive a stable, secret-free resolution key for a four-cell combination. */
export function resolutionKeyFor(
  modelEntryRef: string,
  harnessRef: string,
  providerProfileRef?: string,
  runtimeProfileRef?: string,
  adapterId?: string,
  adapterVersion?: string,
): string {
  // 固定槽位并使用结构化编码；可选槽位省略和分隔符出现在 ID 中都不能碰撞。
  // 此 key 是不透明的投影标识，不替换已持久化 Recipe/Thread/Session 身份。
  return JSON.stringify([
    modelEntryRef,
    harnessRef,
    providerProfileRef,
    runtimeProfileRef,
    adapterId,
    adapterVersion,
  ]);
}

/**
 * Map a native/internal status plus readiness into the three-tier product
 * status the UI may display. `IMPOSSIBLE` fails closed: without verified
 * readiness there is no executable combination.
 */
export function resolveUiStatus(input: CompatibilityReadinessInput): {
  status: "NATIVE" | "CRAFTABLE" | "IMPOSSIBLE";
  internalStatus: "NATIVE" | "SUPPORTED" | "EXPERIMENTAL" | "INCOMPATIBLE" | "UNAVAILABLE";
  source: "native" | "compatibility-layer" | "unavailable";
  /** Stable route reason for honest failure display (never a fake status). */
  routeReason?: string | undefined;
  routeReasonCode: ExecutionRouteReasonCode;
} {
  const { modelEntry, harnessRef, harnessReady, openCodeRouteReady, compatibilityBridgeReady } =
    input;
  const routeDecision = resolveExecutionRoute({
    modelEntry,
    harnessRef,
    harnessReady,
    openCodeRouteReady,
    compatibilityBridgeReady,
  });

  if (routeDecision.routeType === "fail-closed") {
    const isOpencodeUnready = harnessRef?.harnessKind === "opencode" && openCodeRouteReady !== true;
    return {
      status: "IMPOSSIBLE",
      internalStatus: isOpencodeUnready ? "EXPERIMENTAL" : "UNAVAILABLE",
      source: isOpencodeUnready ? "compatibility-layer" : "unavailable",
      ...(routeDecision.reason ? { routeReason: routeDecision.reason } : {}),
      routeReasonCode: routeDecision.reasonCode,
    };
  }

  if (routeDecision.routeType === "native") {
    return {
      status: "NATIVE",
      internalStatus: "NATIVE",
      source: "native",
      ...(routeDecision.reason ? { routeReason: routeDecision.reason } : {}),
      routeReasonCode: routeDecision.reasonCode,
    };
  }

  return {
    status: "CRAFTABLE",
    internalStatus: "SUPPORTED",
    source: "compatibility-layer",
    ...(routeDecision.reason ? { routeReason: routeDecision.reason } : {}),
    routeReasonCode: routeDecision.reasonCode,
  };
}

/** Compose the full CapabilityResolution for a four-cell combination. */
export function resolveCompatibility(input: CompatibilityReadinessInput): CapabilityResolution {
  const statusInfo = resolveUiStatus(input);
  const resolution: CapabilityResolution = {
    resolutionKey: resolutionKeyFor(
      input.modelEntry?.entryId ?? "",
      input.harnessRef?.harnessItemId ?? "",
      input.modelEntry?.accountId,
      undefined,
      input.adapterId,
      input.adapterVersion,
    ),
    createdAt: new Date().toISOString(),
    status: statusInfo.status,
    internalStatus: statusInfo.internalStatus,
    source: statusInfo.source,
    modelEntryRef: input.modelEntry?.entryId ?? "",
    harnessRef: input.harnessRef?.harnessItemId ?? "",
    ...(input.modelEntry?.accountId ? { providerProfileRef: input.modelEntry.accountId } : {}),
    ...(input.adapterId ? { adapterId: input.adapterId } : {}),
    ...(input.adapterVersion ? { adapterVersion: input.adapterVersion } : {}),
    capabilities: input.capabilities ?? [],
    diagnostics:
      statusInfo.status === "IMPOSSIBLE"
        ? [
            {
              code:
                statusInfo.routeReasonCode === "BRIDGE_NOT_READY"
                  ? "CPA_NOT_INSTALLED"
                  : "RUNTIME_UNAVAILABLE",
              phase: "readiness",
              message: statusInfo.routeReason
                ? translateRouteReason(statusInfo.routeReasonCode, statusInfo.routeReason)
                : !input.modelEntry
                  ? "缺少模型组件"
                  : !input.harnessRef
                    ? "缺少 Harness 组件"
                    : input.harnessRef.harnessKind === "opencode" &&
                        input.openCodeRouteReady !== true
                      ? "OpenCode 路由 readiness 未验证"
                      : "Harness 未就绪或不可用",
              remediation:
                statusInfo.routeReasonCode === "BRIDGE_NOT_READY"
                  ? "点击「合成」将自动安装并启动 CLIProxyAPI，也可在右侧组件栏点击安装"
                  : "请安装/配置所选 Harness，或更换可用的模型/Harness 组合",
            },
          ]
        : [],
  };
  return resolution;
}

/**
 * Map the stable English route reason to a user-facing message. Cross-vendor
 * combinations name the missing Compatibility Bridge explicitly instead of a
 * generic "不可合成".
 */
function translateRouteReason(code: ExecutionRouteReasonCode, reason: string): string {
  if (code === "BRIDGE_NOT_READY") {
    return "跨厂商组合需要 CLIProxyAPI。未检测到已安装的 sidecar，点击「合成」或组件栏「安装」即可下载官方版本";
  }
  if (code === "BRIDGE_HARNESS_UNSUPPORTED") {
    return "目标 Harness 不支持兼容桥投影";
  }
  if (code === "HARNESS_NOT_READY") {
    return "Harness 未安装、未登录或运行环境未就绪";
  }
  if (code === "OPENCODE_NOT_READY") {
    return "OpenCode 路由 readiness 未验证";
  }
  if (code === "OPENCODE_VENDOR_UNVERIFIED") {
    return "该模型厂商暂无已验证的 OpenCode 原生路由";
  }
  return reason;
}
