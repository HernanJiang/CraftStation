import { loader, type Monaco } from "@monaco-editor/react";
import { captureRendererException } from "@/renderer/diagnostics/sentry";
import {
  markMonacoWorkerEvent,
  publishMonacoRuntimeFailure,
  type MonacoFailurePhase,
  type MonacoRuntimeFailure,
} from "@/renderer/monacoFailureIsolation";

type WorkerConstructor = new () => Worker;
type WorkerKind = "css" | "editor" | "html" | "json" | "typescript";

// Filled by initializeMonaco(). Kept off the static import graph so opening the
// files panel does not parse the Monaco chunk before a text buffer is shown.
let workerConstructors: Record<WorkerKind, WorkerConstructor> | null = null;

async function loadWorkerConstructors(): Promise<void> {
  const [editor, css, html, json, typescript] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/css/css.worker?worker"),
    import("monaco-editor/esm/vs/language/html/html.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
  ]);
  workerConstructors = {
    editor: editor.default,
    css: css.default,
    html: html.default,
    json: json.default,
    typescript: typescript.default,
  };
}

function workerConstructorForLabel(label: string): WorkerConstructor {
  const constructors = workerConstructors;
  if (!constructors) {
    throw new Error("Monaco workers were requested before the local bundles loaded.");
  }
  switch (label) {
    case "json":
      return constructors.json;
    case "css":
    case "less":
    case "scss":
      return constructors.css;
    case "handlebars":
    case "html":
    case "razor":
      return constructors.html;
    case "javascript":
    case "typescript":
      return constructors.typescript;
    default:
      // Monaco's base editor requests the "editorWorkerService" label.
      return constructors.editor;
  }
}

export function reportMonacoRuntimeFailure(
  reason: unknown,
  context: { phase: MonacoFailurePhase; workerLabel?: string },
): MonacoRuntimeFailure {
  const failure = publishMonacoRuntimeFailure(reason, context);
  console.error(`[craftstation][monaco:${failure.phase}]`, {
    error: failure.error,
    workerLabel: failure.workerLabel,
  });
  captureRendererException(failure.error, { featureArea: "file-editor" });
  return failure;
}

export function createMonacoWorker(label: string): Worker {
  try {
    const worker = new (workerConstructorForLabel(label))();
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      // Monaco forwards this event to onUnexpectedError, which rethrows it on
      // a timer. Mark the event itself so that rethrow stays in the editor.
      markMonacoWorkerEvent(event);
      reportMonacoRuntimeFailure(
        event.error ?? event.message ?? new Error(`Monaco ${label} worker failed.`),
        {
          phase: "worker",
          workerLabel: label,
        },
      );
    });
    worker.addEventListener("messageerror", (event) => {
      event.preventDefault();
      markMonacoWorkerEvent(event);
      reportMonacoRuntimeFailure(new Error(`Monaco ${label} worker message could not be read.`), {
        phase: "worker",
        workerLabel: label,
      });
    });
    return worker;
  } catch (error) {
    throw reportMonacoRuntimeFailure(error, { phase: "worker", workerLabel: label }).error;
  }
}

globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return createMonacoWorker(label);
  },
};

let initialization: Promise<Monaco> | null = null;

async function loadBundledMonaco(): Promise<Monaco> {
  try {
    // Install workers before monaco-editor evaluates. Both imports stay dynamic
    // so a files panel with no text buffer does not download or parse Monaco.
    await loadWorkerConstructors();
    const localMonaco = await import("monaco-editor");
    // Supplying the ESM instance prevents @monaco-editor/react from invoking
    // any AMD loader.
    loader.config({ monaco: localMonaco });
    return await loader.init();
  } catch (error) {
    throw reportMonacoRuntimeFailure(error, { phase: "initialization" }).error;
  }
}

export function initializeMonaco(): Promise<Monaco> {
  initialization ??= loadBundledMonaco();
  return initialization;
}
