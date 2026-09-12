import { toast } from "@heroui/react";
import { msg } from "@/shared/messages";
import type { UpdateStatus } from "@/shared/ipc";
import { useUpdateStore } from "@/renderer/state/updateStore";
import type { WorkbenchContribution } from "../lifecycle";
import type { WorkbenchServices } from "../services";

export function handleUpdateStatus(status: UpdateStatus): void {
  const store = useUpdateStore.getState();
  switch (status.type) {
    case "checking":
      store.setChecking();
      break;
    case "update-available":
      store.beginUpdateDownload(status.version);
      break;
    case "update-not-available":
      store.setNotAvailable();
      break;
    case "downloading":
      store.setDownloading(status.percent, {
        transferred: status.transferred,
        total: status.total,
        bytesPerSecond: status.bytesPerSecond,
      });
      break;
    case "downloaded":
      store.setDownloaded(status.version);
      break;
    case "error": {
      const detail = status.messageKey ? msg(status.messageKey) : status.message;
      store.setError(detail);
      // Background launch/hourly probes set notify: false so a missing feed or
      // flaky GitHub check cannot toast on every app open.
      if (status.notify !== false) {
        toast.danger(msg("update.error", { detail }));
      }
      break;
    }
  }
}

export const updatesContribution: WorkbenchContribution<WorkbenchServices> = {
  id: "updates",
  phase: "starting",
  activate: ({ services }) => services.bridge.onUpdateStatus(handleUpdateStatus),
};
