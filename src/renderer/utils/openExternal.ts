import { toast } from "@heroui/react";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";

export function openExternalWithFeedback(url: string, options?: { successMessage?: string }): void {
  void readBridge()
    .openExternal(url)
    .then(() => {
      if (options?.successMessage) toast.success(options.successMessage);
    })
    .catch((error: unknown) => {
      toast.danger(friendlyError(error));
    });
}
