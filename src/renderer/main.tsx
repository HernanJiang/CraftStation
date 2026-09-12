import { createRoot, type Root } from "react-dom/client";
import "./tailwind.css";
import "./uiAnimationActivity";
import { readBridge } from "./bridge";
import { captureRendererException, initializeRendererSentry } from "./diagnostics/sentry";
import { getAppName } from "@/shared/appName";
import {
  createRendererCrashReport,
  RendererCrashScreen,
  RendererErrorBoundary,
  type RendererCrashKind,
  type RendererCrashReport,
} from "./RendererCrashScreen";
import { isIgnorableRejection, isIgnorableWindowError } from "./rendererGlobalErrors";
import { bootstrapAppThemeFromCache } from "./theme/applyAppTheme";
import { bootstrapAppLocaleFromCache } from "./i18n/i18n";

function logRendererBootstrap(message: string): void {
  if (import.meta.env.DEV) performance.mark(`craftstation:${message}`);
  console.log(`[renderer-bootstrap] page +${Math.round(performance.now())}ms ${message}`);
}

logRendererBootstrap("main module evaluated");

if (import.meta.env.DEV) {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const head = args[0];
    if (
      typeof head === "string" &&
      (((head.startsWith("<Focusable>") || head.startsWith("<Pressable>")) &&
        ((head.includes("interactive ARIA role") &&
          (head.includes('Got "none"') || head.includes('Got "presentation"'))) ||
          head.includes("child must be focusable"))) ||
        head.startsWith("A PressResponder was rendered without a pressable child."))
    ) {
      return;
    }
    warn(...args);
  };
}

document.title = getAppName(readBridge().channel, import.meta.env.DEV);
initializeRendererSentry();

document.documentElement.dataset.platform =
  typeof window !== "undefined" && "craftstation" in window ? readBridge().platform : "unknown";
document.documentElement.dataset.windowKind = readBridge().windowKind;

// The translucent ("liquid glass") sidebar is applied by provider.tsx only once
// the main content is ready — the window stays opaque (the index.html boot
// background) through loading so it doesn't show a bare translucent window.

// Apply the cached appearance + theme before first paint so a non-default theme
// doesn't flash the base palette on launch.
bootstrapAppThemeFromCache();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

let reactRoot: Root | null = null;

function installDevBridgeAfterPaint(): void {
  if (!import.meta.env.DEV) return;
  const install = () => {
    void import("./devBridge").then(({ installDevBridge }) => installDevBridge());
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(install, { timeout: 5_000 });
  } else {
    window.setTimeout(install, 0);
  }
}
let renderingCrashScreen = false;

function reportRootError(
  kind: "caught" | "uncaught" | "recoverable",
  error: unknown,
  errorInfo: { componentStack?: string | undefined },
) {
  const componentStack = errorInfo.componentStack?.trim();
  const prefix = `[craftstation][react:${kind}]`;

  if (kind === "recoverable") {
    console.warn(prefix, error, componentStack ?? "");
    captureRendererException(error, { featureArea: "react" }, componentStack);
    return;
  }

  console.error(prefix, error, componentStack ?? "");
  captureRendererException(error, { featureArea: "react" }, componentStack);
}

function renderCrashScreen(report: RendererCrashReport): void {
  if (renderingCrashScreen) return;
  renderingCrashScreen = true;
  console.error(`[craftstation][renderer:${report.kind}]`, report);
  try {
    reactRoot?.render(<RendererCrashScreen report={report} />);
  } finally {
    renderingCrashScreen = false;
  }
}

function buildSource(event: ErrorEvent): string | undefined {
  if (!event.filename) return undefined;
  const suffix =
    event.lineno > 0 ? `:${event.lineno}${event.colno > 0 ? `:${event.colno}` : ""}` : "";
  return `${event.filename}${suffix}`;
}

function showCrash(
  kind: RendererCrashKind,
  error: unknown,
  source?: string,
  options: { capture?: boolean } = {},
): void {
  renderCrashScreen(
    createRendererCrashReport({
      kind,
      error,
      ...(source ? { source } : {}),
    }),
  );
  if (options.capture ?? true) {
    captureRendererException(error, { featureArea: "renderer" });
  }
}

// Capture phase so this runs before other window `error` listeners (e.g. Vite's
// dev overlay): for the benign "ResizeObserver loop … undelivered notifications"
// warning we stopImmediatePropagation so it never reaches the dev overlay, which
// would otherwise flood with it during panel resizes. Already harmless in prod.
window.addEventListener(
  "error",
  (event) => {
    if (!(event instanceof ErrorEvent)) return;
    if (isIgnorableWindowError(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Sentry's Electron renderer integration already captures global errors; this only swaps UI.
    showCrash("uncaught", event.error ?? event.message, buildSource(event), { capture: false });
  },
  { capture: true },
);

window.addEventListener("unhandledrejection", (event) => {
  if (isIgnorableRejection(event.reason)) {
    event.preventDefault();
    return;
  }
  // Sentry's Electron renderer integration already captures global rejections; this only swaps UI.
  showCrash("unhandled-rejection", event.reason, undefined, { capture: false });
});

reactRoot = createRoot(root, {
  onCaughtError(error, errorInfo) {
    reportRootError("caught", error, errorInfo);
  },
  onUncaughtError(error, errorInfo) {
    reportRootError("uncaught", error, errorInfo);
    renderCrashScreen(
      createRendererCrashReport({
        kind: "react",
        error,
        ...(errorInfo.componentStack?.trim()
          ? { componentStack: errorInfo.componentStack.trim() }
          : {}),
      }),
    );
  },
  onRecoverableError(error, errorInfo) {
    reportRootError("recoverable", error, errorInfo);
  },
});

// Load the app, provider registrations, workbench composition, and cached
// locale in parallel. Provider registration used to sit behind the app chunk
// as an eager dependency, adding another transform waterfall before React
// could mount; the workbench joins the same parallel batch so composing the
// window scope adds no sequential round-trip before first render.
logRendererBootstrap("starting app, provider, workbench, and locale imports");
// Startup attribution: each parallel import stamps its own resolve time so a
// future slow-start investigation can tell provider/bootstrap cost apart from
// app/workbench/locale cost without guessing. Kept as data (not a gate).
const bootstrapT0 = performance.now();
const bootstrapAttribution: Record<string, number> = {};
function stampBootstrapImport(name: string): void {
  bootstrapAttribution[name] = Math.round((performance.now() - bootstrapT0) * 10) / 10;
  logRendererBootstrap(`${name} module resolved`);
}
function publishBootstrapAttribution(): void {
  bootstrapAttribution.totalMs = Math.round((performance.now() - bootstrapT0) * 10) / 10;
  try {
    (window as unknown as { __craftstationBootstrapAttribution?: Record<string, number> })
      .__craftstationBootstrapAttribution = { ...bootstrapAttribution };
  } catch {
    // Attribution is best-effort; a hostile embedder must not break startup.
  }
  if (import.meta.env.DEV) {
    console.log("[renderer-bootstrap] attribution (ms since bootstrap start)", {
      ...bootstrapAttribution,
    });
  }
}
const appModulePromise = import("./app").then((module) => {
  stampBootstrapImport("app");
  return module;
});
const providerBootstrapPromise = import("./components/providers/bootstrap").then((module) => {
  stampBootstrapImport("provider");
  return module;
});
const workbenchModulePromise = import("./workbench/createWindowWorkbench").then((module) => {
  stampBootstrapImport("workbench");
  return module;
});
const localeBootstrapPromise = bootstrapAppLocaleFromCache().then(() => {
  stampBootstrapImport("locale");
});

void Promise.all([appModulePromise, providerBootstrapPromise, workbenchModulePromise, localeBootstrapPromise])
  .then(([{ App }, , { createWindowWorkbench }]) => {
    publishBootstrapAttribution();
    logRendererBootstrap("rendering React app");
    let workbench;
    try {
      workbench = createWindowWorkbench();
    } catch (error: unknown) {
      showCrash("bootstrap", error);
      return;
    }
    window.addEventListener("pagehide", () => workbench.dispose(), { once: true });
    reactRoot?.render(
      <RendererErrorBoundary captureCaughtErrors={false}>
        <App workbench={workbench} />
      </RendererErrorBoundary>,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => logRendererBootstrap("first React frame painted"));
    });
    installDevBridgeAfterPaint();
  })
  .catch((error: unknown) => {
    showCrash("bootstrap", error);
  });
