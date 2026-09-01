import { useEffect, useRef } from "react";
import { ActivityBridge } from "@craftstation/activity-bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { isNativeApp } from "../pwaInstall";
import { createBackgroundRemoteClient } from "../remoteSessionTransport";
import { getOrCreateDeviceId } from "../storage";
import { configureLiveActivities } from "./liveActivityController";
import { syncPushRegistration, teardownPushListeners, unregisterPush } from "./pushRegistration";

/** Just the connection fields the push lifecycle needs from the remote session. */
export interface PushLifecycleInput {
  /** Retained for API compatibility; native push registration is lifecycle-only here. */
  readonly connected: boolean;
  readonly activeDesktop: {
    readonly desktopId: string;
    readonly endpoint: string;
    readonly accessToken: string;
    readonly label: string;
  } | null;
}

/**
 * Wires native Live Activities into the remote-session lifecycle. Native
 * builds keep APNs/FCM and Live Activity registration in this hook; desktop and
 * PWA sessions receive ordinary agent notifications through the shared
 * `thread-user-notification` toast event instead of browser or OS notifications.
 *
 * Live Activity context tracks the active desktop identity (not the socket), so
 * an activity keeps driving across reconnects and only tears down on a desktop
 * switch / unpair.
 */
export function usePushLifecycle(input: PushLifecycleInput): void {
  const notificationsEnabled = useSharedSettings((state) => state.notificationsEnabled);
  const { connected } = input;
  const desktop = input.activeDesktop;
  const desktopId = desktop?.desktopId;
  const desktopLabel = desktop?.label;
  const endpoint = desktop?.endpoint;
  const accessToken = desktop?.accessToken;
  // Latest label read without re-running the effect below — a rename must not
  // tear down the running activity (see the deps note).
  const desktopLabelRef = useRef(desktopLabel);
  desktopLabelRef.current = desktopLabel;

  // Live Activity context — keyed on the desktop identity.
  useEffect(() => {
    if (!isNativeApp() || !desktopId) return;
    let cancelled = false;
    void (async () => {
      try {
        const supported = await ActivityBridge.isSupported();
        if (!cancelled && supported.liveActivities) {
          configureLiveActivities({
            desktopId,
            desktopName: desktopLabelRef.current ?? desktopId,
          });
        }
      } catch {
        // Live Activities unsupported on this OS — stay inert.
      }
    })();
    return () => {
      cancelled = true;
      // Ends any running activity and clears tracked threads on switch/unpair.
      configureLiveActivities(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on desktopId only; a same-desktop rename updates desktopLabelRef without ending the running activity
  }, [desktopId]);

  // Desktop identity lifecycle: switching desktops, re-pairing (new token), or
  // unmounting leaves the previous desktop's registration scope. Clear the
  // fingerprint there; plain connected/offline flips below only detach
  // listeners and keep the reconnect dedupe state.
  useEffect(() => {
    if (!isNativeApp() || !desktopId || !endpoint || !accessToken) return;
    return () => {
      void teardownPushListeners({ resetSentState: true });
    };
  }, [desktopId, endpoint, accessToken]);

  // Native push registration remains separate from the renderer toast path;
  // PWA/browser notifications are intentionally not requested or registered.
  // Native builds use APNs/FCM and Live Activities, while desktop/PWA sessions
  // receive thread-user-notification events over the live application channel.
  useEffect(() => {
    if (!isNativeApp() || !desktopId || !endpoint || !accessToken) return;
    let cancelled = false;
    const client = createBackgroundRemoteClient(endpoint, accessToken);
    void (async () => {
      if (!notificationsEnabled) {
        await teardownPushListeners({ resetSentState: true });
        const deviceId = await getOrCreateDeviceId();
        if (!cancelled) await unregisterPush(client, deviceId);
        return;
      }
      if (!connected) return;
      const deviceId = await getOrCreateDeviceId();
      if (cancelled) return;
      await syncPushRegistration(client, { deviceId, shouldCancel: () => cancelled });
    })();
    return () => {
      cancelled = true;
      void teardownPushListeners();
    };
  }, [connected, desktopId, endpoint, accessToken, notificationsEnabled]);
}
