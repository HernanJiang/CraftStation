import { useState } from "react";
import { toast } from "@heroui/react";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProviderUsage } from "@/renderer/state/providerUsageStore";
import {
  useHasStoredSession,
  useUsageLoginStateStore,
} from "@/renderer/state/usageLoginStateStore";
import { refreshAndMergeProviderUsage } from "./refreshProviderUsageSnapshot";
import {
  externalBrowserLoginUrl,
  needsBrowserSessionForUsage,
  supportsApiKeyLogin,
  supportsBrowserLogin,
  usesSystemBrowserOAuth,
} from "./usageProviders";
import { openExternalWithFeedback } from "@/renderer/utils/openExternal";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";

/**
 * Sign-in / sign-out flow for a usage provider, shared by the usage panel card
 * and the Settings → Usage rows so both surfaces behave identically (browser
 * overlay capture, API-key paste, and persistent stored-session sync). Reads the
 * live snapshot to decide whether a "Sign in" affordance is warranted.
 */
export function useUsageProviderLogin(id: string) {
  const snapshot = useProviderUsage(id);
  const hasStoredSession = useHasStoredSession(id);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [cookie, setCookie] = useState("");
  const isRemote = isRemoteSession();

  const isApiKeyLogin = supportsApiKeyLogin(id);
  const isBrowserLogin = supportsBrowserLogin(id);
  const externalLoginUrl = externalBrowserLoginUrl(id);
  const systemBrowserOAuth = usesSystemBrowserOAuth(id);
  const supportsLogin = !isRemote && (isBrowserLogin || isApiKeyLogin);
  // A stored session the latest fetch reports as rejected (expired cookie) still
  // warrants a "Sign in" to re-auth; an unauthenticated provider always does. But
  // never prompt sign-in once a fetch succeeds ("ok"): a provider authenticated
  // by another path (e.g. Copilot's OAuth/CLI token) has no stored cookie session
  // yet is signed in — offering "Sign in" there is wrong.
  const sessionRejected = snapshot?.status === "auth-missing";
  // OpenCode can report a local Go plan before its browser session is captured,
  // but the usage meters are only available through that web session. Keep the
  // sign-in action visible for the empty-meter state, including a cached snapshot
  // from before the browser session was captured.
  const needsUsageSession =
    !hasStoredSession &&
    needsBrowserSessionForUsage(id) &&
    snapshot?.status === "ok" &&
    snapshot.windows.length === 0;
  const canSignIn =
    supportsLogin &&
    (snapshot?.status !== "ok" || needsUsageSession) &&
    (!hasStoredSession || sessionRejected);
  const canBrowserSignIn = canSignIn && isBrowserLogin;
  const canApiKeySignIn = canSignIn && isApiKeyLogin;
  const canManageApiKey = supportsLogin && isApiKeyLogin;
  // The usage panel hides sign-in once a provider is connected, but the
  // account-management surfaces still need a real action for "Add account" /
  // "Re-authorize". Keep this separate from `canSignIn` so callers do not
  // have to fake an auth-missing snapshot just to open the existing flow.
  const canReauthenticate = supportsLogin && isBrowserLogin;
  const canSignOut =
    !isRemote &&
    ((supportsLogin && hasStoredSession) ||
      id === "grok" ||
      id === "commandcode" ||
      id === "antigravity");

  const refreshAgentStatus = async (): Promise<void> => {
    try {
      await readBridge().refreshAgentStatuses?.(currentWslDistros(), {
        agentKinds: [id],
      });
    } catch (error) {
      console.warn(`[usage-login] failed to refresh ${id} agent status`, error);
    }
  };

  const handleSignIn = async () => {
    if (externalLoginUrl) {
      // External-browser providers sign in in the user's own browser; the
      // caller surfaces the cookie-paste form. No embedded capture tab, and
      // no lingering "signing in" state — completion is the cookie submit.
      openExternalWithFeedback(externalLoginUrl, {
        successMessage: "已在默认浏览器打开登录页面。登录完成后请返回粘贴 Cookie。",
      });
      return;
    }
    if (systemBrowserOAuth) {
      setSigningIn(true);
      try {
        const outcome = await readBridge().startUsageLogin({ providerId: id });
        if (!outcome.ok) {
          if (!outcome.cancelled) toast.danger(outcome.error ?? `Unable to sign in to ${id}.`);
          return;
        }
        useUsageLoginStateStore.getState().setStored(id, true);
        await refreshAndMergeProviderUsage(id);
        await refreshAgentStatus();
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : `Unable to sign in to ${id}.`);
      } finally {
        setSigningIn(false);
      }
      return;
    }
    setSigningIn(true);
    // Open the browser-overlay drawer (not maximized) so the login tab renders
    // there. Force-clear maximized in case a prior session left it fullscreen.
    usePanelStore.getState().setBrowserOverlayMaximized(false);
    usePanelStore.getState().setBrowserOverlayOpen(true);

    // Successful capture closes the login tab, which dismisses the overlay when
    // it was the last tab. Treat overlay close as a cancel *signal* only — never
    // as the login outcome — so "Use Session" can still finish sealing the secret
    // and refresh usage afterward. Cancel is a no-op once capture has settled.
    const unsubscribe = usePanelStore.subscribe((state, prev) => {
      if (prev.browserOverlayOpen && !state.browserOverlayOpen) {
        void readBridge()
          .cancelUsageLogin({ providerId: id })
          .catch(() => {});
      }
    });

    try {
      const outcome = await readBridge().startUsageLogin({ providerId: id });
      // Dismiss the overlay once the login completes (no-op if tab cleanup already
      // closed it). Unsubscribe first so this dismiss doesn't re-fire cancel.
      unsubscribe();
      usePanelStore.getState().setBrowserOverlayOpen(false);
      if (!outcome.ok) {
        if (!outcome.cancelled) {
          toast.danger(outcome.error ?? `Unable to sign in to ${id}.`);
        }
        return;
      }
      // Mark the session stored so the UI reads as signed in immediately,
      // independent of whether the usage fetch below yields displayable data.
      useUsageLoginStateStore.getState().setStored(id, true);
      await refreshAndMergeProviderUsage(id);
      await refreshAgentStatus();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : `Unable to sign in to ${id}.`);
    } finally {
      unsubscribe();
      setSigningIn(false);
    }
  };

  const handleSubmitApiKey = async (): Promise<boolean> => {
    const key = apiKey.trim();
    if (!key || signingIn) return false;
    setSigningIn(true);
    try {
      const outcome = await readBridge().submitUsageApiKey({ providerId: id, apiKey: key });
      if (!outcome.ok) {
        toast.danger(outcome.error ?? `Unable to save the ${id} API key.`);
        return false;
      }
      setApiKey("");
      useUsageLoginStateStore.getState().setStored(id, true);
      await refreshAndMergeProviderUsage(id);
      return true;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : `Unable to save the ${id} API key.`);
      return false;
    } finally {
      setSigningIn(false);
    }
  };

  const handleSubmitCookie = async (): Promise<boolean> => {
    const value = cookie.trim();
    if (!value || signingIn) return false;
    setSigningIn(true);
    try {
      const outcome = await readBridge().submitUsageCookie({ providerId: id, cookie: value });
      if (!outcome.ok) {
        toast.danger(outcome.error ?? "Unable to save the " + id + " session cookie.");
        return false;
      }
      setCookie("");
      useUsageLoginStateStore.getState().setStored(id, true);
      await refreshAndMergeProviderUsage(id);
      await refreshAgentStatus();
      toast.success(`${id} usage session connected.`);
      return true;
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Unable to save the " + id + " session cookie.",
      );
      return false;
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async (): Promise<boolean> => {
    if (signingOut) return false;
    setSigningOut(true);
    try {
      const outcome = await readBridge().clearUsageLogin({ providerId: id });
      if (!outcome.ok) {
        toast.danger(`Unable to sign out of ${id}.`);
        return false;
      }
      // Drop the supervisor's cached snapshot (memory + persisted cache) in the
      // same breath: a remembered identity (e.g. Antigravity's app-not-running
      // preservation) must never resurrect a deleted authorization.
      await readBridge()
        .forgetProviderUsage?.({ providerId: id })
        .catch(() => undefined);
      useUsageLoginStateStore.getState().setStored(id, false);
      await refreshAndMergeProviderUsage(id);
      return true;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : `Unable to sign out of ${id}.`);
      return false;
    } finally {
      setSigningOut(false);
    }
  };

  return {
    supportsLogin,
    canSignIn,
    canBrowserSignIn,
    canApiKeySignIn,
    canManageApiKey,
    canReauthenticate,
    canSignOut,
    signingIn,
    signingOut,
    apiKey,
    setApiKey,
    cookie,
    setCookie,
    externalLoginUrl,
    handleSignIn,
    handleSubmitApiKey,
    handleSubmitCookie,
    handleSignOut,
  };
}
