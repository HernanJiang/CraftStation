import { toast } from "@heroui/react";
import { msg as linguiMsg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";

/**
 * Window transient status toasts (已切换至 X / quota-exhausted and
 * friends). They share the default top-start toast queue with every other
 * task notification, so all notices render the identical opaque `lc-toast`
 * box and emerge from the same top-left region — never a separate
 * transparent overlay competing with chat content. Failures keep the
 * existing error toasts.
 */

export function poolFailoverToastCopy(
  provider: string,
  fromAccount: string,
  toAccount: string,
): { title: string; description: string } {
  return {
    title: i18n._(linguiMsg`${provider}账号${fromAccount}额度已耗尽`),
    description: i18n._(linguiMsg`已切换到${toAccount}继续作答`),
  };
}

export function turnRetryToastCopy(
  attempt: number,
  maxAttempts: number,
  delaySeconds: number,
  reason: string,
): { title: string; description: string } {
  return {
    title: i18n._(
      linguiMsg`网络/连接中断，${delaySeconds} 秒后自动重试（第 ${attempt}/${maxAttempts} 次）`,
    ),
    description: reason,
  };
}

export function mcpInjectionDropCopy(serverNames: string[]): { title: string; body: string } {
  return {
    title: i18n._(linguiMsg`${serverNames.length} 个 MCP 服务器未能注入会话`),
    body: i18n._(
      linguiMsg`${serverNames.join("、")} 未注入：当前 Agent 不接受对应的 MCP 传输方式。会话已正常启动，但这些服务器在本次对话中不可用。`,
    ),
  };
}

export function showTopStatusToast(
  title: string,
  options?: { description?: string; timeout?: number },
): string {
  return toast(title, {
    ...(options?.description ? { description: options.description } : {}),
    variant: "default",
    timeout: options?.timeout ?? 3000,
  });
}
