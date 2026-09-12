import { Trans } from '@lingui/react/macro';
import { Suspense, useEffect, useState } from 'react';
import { PixelLoader } from './components/common/PixelLoader';
import { WelcomeOverlay } from './views/WelcomeOverlay';
import { isWelcomeSeen } from './state/welcomeGateStore';
import { StartupRecoveryScreen } from './components/startup/StartupRecoveryScreen';
import { readBridge } from './bridge';
import { useAppHydration } from './hooks/useAppHydration';
import { usePrWatchAgentSync } from './hooks/usePrWatchAgentSync';
import { AppProvider } from './components/ui/provider';
import { ImageLightboxHost } from './components/composer/ImageLightbox';
import { MainView } from './views/MainView/MainView';
import { QuickComposerOverlay } from './views/QuickComposerOverlay/QuickComposerOverlay';
import { useCommandPaletteStore } from './commands/commandPaletteStore';
import { BrowserPanel } from './views/MainView/parts/RightPanel/parts/BrowserPanel/BrowserPanel';
import { useBrowserSync } from './views/MainView/parts/RightPanel/parts/BrowserPanel/hooks/useBrowserSync';
import { useStandaloneWindowViewTracking } from './analytics/useProductViewTracking';
import { DeferredCommandPalette as PrewarmedCommandPalette } from './deferredFeatures';
import { useWorkbenchLifecycle } from './workbench/useWorkbenchLifecycle';
import type { Workbench } from './workbench/lifecycle';

export const STARTUP_RECOVERY_TIMEOUT_MS = 15_000;
const windowKind = readBridge().windowKind;
const isBrowserExtractWindow = windowKind === 'browserExtract';
const isQuickComposerWindow = windowKind === 'quickComposer';

export function App({ workbench }: { workbench: Workbench }) {
  if (isBrowserExtractWindow) {
    return <BrowserExtractApp />;
  }
  if (isQuickComposerWindow) {
    return <QuickComposerApp workbench={workbench} />;
  }
  return <MainApp workbench={workbench} />;
}

function BrowserExtractApp() {
  useBrowserSync();
  useStandaloneWindowViewTracking("browser_extracted");

  return (
    <AppProvider contentReady syncWindowChrome={false}>
      <div className="flex h-screen w-screen overflow-hidden bg-[var(--content-background)] text-foreground">
        <BrowserPanel visible surface="window" />
      </div>
    </AppProvider>
  );
}

function QuickComposerApp({ workbench }: { workbench: Workbench }) {
  const { initialLoading } = useAppHydration({ runtimeOwner: false });
  useStandaloneWindowViewTracking("quick_composer", !initialLoading);
  useWorkbenchLifecycle(workbench, !initialLoading, !initialLoading);

  return (
    <AppProvider contentReady={!initialLoading} syncWindowChrome={false}>
      {initialLoading ? (
        <div className="quick-composer-root">
          <div className="quick-composer-status">
            <PixelLoader size="sm" />
          </div>
        </div>
      ) : (
        <QuickComposerOverlay />
      )}
      <ImageLightboxHost />
    </AppProvider>
  );
}

function MainApp({ workbench }: { workbench: Workbench }) {
  const { initialLoading, runtimeSnapshotsReady, storeHydrated, loadT0 } = useAppHydration();
  useWorkbenchLifecycle(workbench, !initialLoading, runtimeSnapshotsReady);
  // App-scoped, not overlay-scoped: PR watches must follow the current helper
  // agent whether or not the user opens the Git Review sidebar.
  usePrWatchAgentSync(!initialLoading);
  const [showStartupRecovery, setShowStartupRecovery] = useState(false);
  const [startupRecoveryCycle, setStartupRecoveryCycle] = useState(0);

  useEffect(() => {
    if (!initialLoading) {
      setShowStartupRecovery(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setShowStartupRecovery(true);
    }, STARTUP_RECOVERY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [initialLoading, startupRecoveryCycle]);


  return (
    <AppProvider contentReady={!initialLoading}>
      {showStartupRecovery ? (
        <StartupRecoveryScreen
          onKeepWaiting={() => {
            setShowStartupRecovery(false);
            setStartupRecoveryCycle((cycle) => cycle + 1);
          }}
        />
      ) : (
        <>
          {!initialLoading ? (
            <>
              <MainView
                storeHydrated={storeHydrated}
                runtimeSnapshotsReady={runtimeSnapshotsReady}
                loadT0={loadT0}
              />
              <DeferredCommandPalette />
              <ImageLightboxHost />
            </>
          ) : isWelcomeSeen() ? (
            <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
              <div className="flex flex-col items-center gap-4">
                <PixelLoader size="lg" />
                <p className="text-sm text-muted">
                  <Trans>Loading…</Trans>
                </p>
              </div>
            </div>
          ) : null}
          <WelcomeOverlay ready={!initialLoading} />
        </>
      )}
    </AppProvider>
  );
}

function DeferredCommandPalette() {
  const open = useCommandPaletteStore((state) => state.isOpen);
  const [enabled, setEnabled] = useState(open);

  useEffect(() => {
    if (open) setEnabled(true);
  }, [open]);

  return enabled ? (
    <Suspense>
      <PrewarmedCommandPalette />
    </Suspense>
  ) : null;
}
