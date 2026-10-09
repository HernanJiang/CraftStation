import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { serviceTierItemPayloadSchema } from "@/shared/contracts";
import { ULTRAFAST_USAGE_NOTE } from "@/shared/codexSpeed";

export function ServiceTierMarker({ item }: { item: RuntimeChatItem }) {
  const parsed = serviceTierItemPayloadSchema.safeParse(
    getRuntimeItemPayload(item, "service_tier"),
  );
  if (!parsed.success) return null;
  const { requested, actual, status } = parsed.data;
  const labels: Record<string, string> = {
    standard: "Standard",
    default: "Standard",
    auto: "Auto",
    fast: "Fast",
    priority: "Fast",
    ultrafast: "Ultrafast",
  };
  const label = (id: string) => labels[id] ?? id;
  const message =
    status === "rejected"
      ? "请求被拒绝"
      : actual
        ? `实际 ${label(actual)}${status === "downgraded" ? " · 已降档" : " · 已确认"}`
        : status === "requested"
          ? "等待服务端确认"
          : "实际档位未报告";
  return (
    <div
      data-testid="service-tier-status"
      className="my-2 text-xs text-muted"
      title={requested === "ultrafast" ? ULTRAFAST_USAGE_NOTE : undefined}
    >
      请求 {label(requested)} · {message}
    </div>
  );
}
