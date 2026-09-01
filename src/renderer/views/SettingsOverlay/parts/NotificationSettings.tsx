import { startTransition } from "react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { NotificationFilter } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { Select, ToggleSwitch } from "@/renderer/components/common";
import { SettingRow, SettingsPage } from "./SettingsForm";
import { useLocalizedOptions } from "./settingsOptions";

const filterOptions = [
  { id: "unfocused", label: msg`Only when unfocused` },
  { id: "all", label: msg({ message: "Always", comment: "Notification filter: always notify" }) },
] as const;

export function NotificationSettings() {
  const { t } = useLingui();
  const doneLabel = t({
    message: "Done",
    comment: "Notification status: thread is done",
  });
  const errorLabel = t({
    message: "Error",
    comment: "Notification status: agent error",
  });
  const notificationsEnabled = useSharedSettings((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSharedSettings((s) => s.setNotificationsEnabled);
  const notificationSound = useSharedSettings((s) => s.notificationSound);
  const setNotificationSound = useSharedSettings((s) => s.setNotificationSound);
  const notificationFilter = useSharedSettings((s) => s.notificationFilter);
  const setNotificationFilter = useSharedSettings((s) => s.setNotificationFilter);
  const notificationStatuses = useSharedSettings((s) => s.notificationStatuses);
  const setNotificationStatuses = useSharedSettings((s) => s.setNotificationStatuses);
  const notifyL2Cli = useSharedSettings((s) => s.notifyL2Cli);
  const setNotifyL2Cli = useSharedSettings((s) => s.setNotifyL2Cli);
  const filterOpts = useLocalizedOptions(filterOptions);

  return (
    <SettingsPage title={t`Notifications`}>
      <SettingRow
        anchorId="notifications.enableNotifications"
        title={t`Enable notifications`}
        description={<Trans>Show notifications when thread status changes.</Trans>}
      >
        <ToggleSwitch
          aria-label={t`Enable notifications`}
          isSelected={notificationsEnabled}
          onChange={(selected) => {
            startTransition(() => {
              setNotificationsEnabled(selected);
            });
          }}
        />
      </SettingRow>

      <div
        className={`space-y-4 transition-opacity ${notificationsEnabled ? "" : "pointer-events-none opacity-40"}`}
      >
        <SettingRow
          anchorId="notifications.playNotificationSound"
          title={t`Play notification sound`}
          description={<Trans>Play a sound when a notification is shown.</Trans>}
        >
          <ToggleSwitch
            aria-label={t`Play notification sound`}
            isSelected={notificationSound}
            onChange={(selected) => {
              startTransition(() => {
                setNotificationSound(selected);
              });
            }}
          />
        </SettingRow>

        <SettingRow
          anchorId="notifications.showNotifications"
          title={t`Show notifications`}
          description={<Trans>When to display in-app toasts for visible threads.</Trans>}
        >
          <Select
            aria-label={t`Show notifications`}
            className="w-[180px] shrink-0"
            options={filterOpts}
            value={notificationFilter}
            onChange={(value) => {
              startTransition(() => {
                setNotificationFilter(value as NotificationFilter);
              });
            }}
          />
        </SettingRow>

        <div className="pt-2">
          <p className="mb-3 text-sm font-medium text-foreground">
            <Trans>Notify me about</Trans>
          </p>
          <div className="space-y-3">
            <div
              id="notifications.notifyDone"
              data-settings-anchor="notifications.notifyDone"
              className="flex scroll-mt-4 items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">{doneLabel}</p>
                <p className="text-xs text-muted">
                  <Trans>Thread finished or waiting for your input.</Trans>
                </p>
              </div>
              <ToggleSwitch
                aria-label={doneLabel}
                isSelected={notificationStatuses.done}
                onChange={(selected) => {
                  startTransition(() => {
                    setNotificationStatuses({ done: selected });
                  });
                }}
              />
            </div>

            <div
              id="notifications.notifyNeedsAttention"
              data-settings-anchor="notifications.notifyNeedsAttention"
              className="flex scroll-mt-4 items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <Trans>Needs Attention</Trans>
                </p>
                <p className="text-xs text-muted">
                  <Trans>Approval or reply required from you.</Trans>
                </p>
              </div>
              <ToggleSwitch
                aria-label={t`Needs Attention`}
                isSelected={notificationStatuses.needsAttention}
                onChange={(selected) => {
                  startTransition(() => {
                    setNotificationStatuses({ needsAttention: selected });
                  });
                }}
              />
            </div>

            <div
              id="notifications.notifyError"
              data-settings-anchor="notifications.notifyError"
              className="flex scroll-mt-4 items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">{errorLabel}</p>
                <p className="text-xs text-muted">
                  <Trans>Agent encountered an error.</Trans>
                </p>
              </div>
              <ToggleSwitch
                aria-label={errorLabel}
                isSelected={notificationStatuses.error}
                onChange={(selected) => {
                  startTransition(() => {
                    setNotificationStatuses({ error: selected });
                  });
                }}
              />
            </div>
          </div>
        </div>

        <SettingRow
          anchorId="notifications.notifyL2Cli"
          className="pt-2"
          title={t`Notify for L2 CLI threads`}
          description={
            <Trans>
              When off, suppress notifications from terminal threads whose status comes from the OSC
              fallback (no CLI hook plugin).
            </Trans>
          }
        >
          <ToggleSwitch
            aria-label={t`Notify for L2 CLI threads`}
            isSelected={notifyL2Cli}
            onChange={(selected) => {
              startTransition(() => {
                setNotifyL2Cli(selected);
              });
            }}
          />
        </SettingRow>
      </div>
    </SettingsPage>
  );
}
