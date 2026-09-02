import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { AlertTriangle, Check, CircleEllipsis, Clock3, X } from "lucide-react";
import type {
  ThreadExchangeStatus,
  ThreadExchangeView,
  ThreadRuntimeProvenance,
} from "@/shared/threadCollaboration";

export const SETTLED_THREAD_EXCHANGE_STATUSES = new Set<ThreadExchangeStatus>([
  "replied",
  "failed",
  "cancelled",
]);

export function collaborationStatusLabel(status: ThreadExchangeStatus): ReactNode {
  switch (status) {
    case "created":
      return <Trans>Created</Trans>;
    case "queued":
      return <Trans>Queued</Trans>;
    case "delivering":
      return <Trans>Delivering</Trans>;
    case "delivered":
      return <Trans>Delivered</Trans>;
    case "target_working":
      return <Trans>Target working</Trans>;
    case "needs_attention":
      return <Trans>Needs attention</Trans>;
    case "replied":
      return <Trans>Replied</Trans>;
    case "cancelling":
      return <Trans>Cancelling</Trans>;
    case "cancelled":
      return <Trans>Cancelled</Trans>;
    case "failed":
      return <Trans>Failed</Trans>;
    case "timed_out":
      return <Trans>Timed out</Trans>;
  }
}

/** Keep runtime status values out of user-facing UI while retaining a stable
 * fallback for statuses introduced by a newer host. */
export function threadTargetStatusLabel(status: string): ReactNode {
  switch (status) {
    case "idle":
      return <Trans>Idle</Trans>;
    case "working":
      return <Trans>Working</Trans>;
    case "launching":
      return <Trans>Launching</Trans>;
    case "needs_approval":
      return <Trans>Needs approval</Trans>;
    case "needs_reply":
      return <Trans>Needs reply</Trans>;
    case "finished":
      return <Trans>Finished</Trans>;
    case "error":
      return <Trans>Error</Trans>;
    case "inactive":
      return <Trans>Inactive</Trans>;
    default:
      return <Trans>Unavailable</Trans>;
  }
}

export function collaborationStatusTone(
  status: ThreadExchangeStatus,
): "default" | "success" | "warning" | "danger" | "accent" {
  switch (status) {
    case "replied":
      return "success";
    case "failed":
    case "cancelled":
      return "danger";
    case "needs_attention":
    case "timed_out":
      return "warning";
    case "target_working":
    case "delivering":
    case "delivered":
      return "accent";
    default:
      return "default";
  }
}

export function CollaborationStatusIcon(props: {
  status: ThreadExchangeStatus;
  className?: string;
}) {
  const className = props.className ?? "size-3.5";
  switch (props.status) {
    case "replied":
      return <Check aria-hidden="true" className={className} />;
    case "failed":
    case "cancelled":
      return <X aria-hidden="true" className={className} />;
    case "needs_attention":
    case "timed_out":
      return <AlertTriangle aria-hidden="true" className={className} />;
    case "target_working":
    case "delivering":
    case "delivered":
      return <CircleEllipsis aria-hidden="true" className={className} />;
    default:
      return <Clock3 aria-hidden="true" className={className} />;
  }
}

export function collaborationCounterpart(
  exchange: ThreadExchangeView,
  threadId: string,
): { direction: "outbound" | "inbound"; provenance: ThreadRuntimeProvenance } {
  return exchange.sourceThreadId === threadId
    ? { direction: "outbound", provenance: exchange.targetProvenance }
    : { direction: "inbound", provenance: exchange.sourceProvenance };
}

export function compositionLabel(provenance: ThreadRuntimeProvenance): string {
  return [provenance.recipeId, provenance.modelId, provenance.harnessId]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}
