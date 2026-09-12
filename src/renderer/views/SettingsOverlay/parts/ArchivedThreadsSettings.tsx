import { startTransition } from "react";
import { Button, Surface, Tooltip } from "@heroui/react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatArchiveAutoDelete, parseArchivedAtMs } from "@/shared/archiveRetention";
import type { ArchiveRetention } from "@/shared/archiveRetention";
import { isRemoteSession } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { deleteThread, unarchiveThread } from "@/renderer/actions/threadActions";
import { Select } from "@/renderer/components/common";
import { SettingRow, SettingsPage } from "./SettingsForm";
import { archiveRetentionOptions, useLocalizedOptions } from "./settingsOptions";

export function ArchivedThreadsSettings() {
  const { t } = useLingui();
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const archivedThreads = threads.filter((thread) => thread.archived);
  const retention = useSharedSettings((s) => s.archiveRetention);
  const setArchiveRetention = useSharedSettings((s) => s.setArchiveRetention);
  const retentionOpts = useLocalizedOptions(archiveRetentionOptions);
  const now = Date.now();
  // Retention cleanup runs on the desktop; a remote session's copy of this
  // value is never read, so hide the row there (parity with ThreadSettings).
  const remote = isRemoteSession();

  return (
    <SettingsPage title={t`Archived Threads`} bodyClassName="">
      {!remote && (
      <SettingRow
        anchorId="threads.archiveRetention"
        title={t`Auto-delete archived threads`}
        description={
          <Trans>
            Archived threads are permanently deleted after this long, counted strictly from when
            each thread was archived. Changing this re-evaluates existing archives immediately.
          </Trans>
        }
      >
        <Select
          aria-label={t`Auto-delete archived threads`}
          className="w-[160px] shrink-0"
          options={retentionOpts}
          value={retention}
          onChange={(value) => {
            startTransition(() => {
              setArchiveRetention(value as ArchiveRetention);
            });
          }}
        />
      </SettingRow>
      )}
      {archivedThreads.length === 0 ? (
        <p className="text-sm text-muted">
          <Trans>No archived threads.</Trans>
        </p>
      ) : (
        <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
          {archivedThreads.map((thread) => {
            const project = projects.find((p) => p.id === thread.projectId);
            // Legacy rows predating `archivedAt` fall back to `updatedAt` once.
            const label = formatArchiveAutoDelete(
              parseArchivedAtMs(thread.archivedAt ?? thread.updatedAt),
              retention,
              now,
            );
            return (
              <div key={thread.id} className="flex items-center gap-3 px-4 py-3">
                <ThreadProviderIcon
                  thread={thread}
                  tone="inactive"
                  className="size-4 shrink-0 text-muted"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium text-foreground">{thread.title}</p>
                  <p className="truncate text-xs text-muted">
                    {project ? `${project.name} · ` : ""}
                    {label.text}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Tooltip delay={150}>
                    <Tooltip.Trigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={t`Restore thread`}
                        onPress={() => unarchiveThread(thread.id)}
                      >
                        <ArchiveRestore className="size-4" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <Trans>Restore thread</Trans>
                    </Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={150}>
                    <Tooltip.Trigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={t`Delete thread`}
                        onPress={() => deleteThread(thread.id)}
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <Trans comment="Tooltip: permanently delete the archived thread">
                        Delete permanently
                      </Trans>
                    </Tooltip.Content>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </Surface>
      )}
    </SettingsPage>
  );
}
