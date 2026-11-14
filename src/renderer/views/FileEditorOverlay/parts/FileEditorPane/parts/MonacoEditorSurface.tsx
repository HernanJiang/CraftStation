import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Editor, type BeforeMount, type OnMount } from "@monaco-editor/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FileWarning } from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  getMonacoRuntimeFailure,
  subscribeToMonacoRuntimeFailure,
  type MonacoRuntimeFailure,
} from "@/renderer/monacoFailureIsolation";
import { initializeMonaco, reportMonacoRuntimeFailure } from "./monacoRuntime";

type MonacoEditorSurfaceProps = {
  path: string;
  language: string;
  theme: string;
  value: string;
  options: MonacoEditor.IStandaloneEditorConstructionOptions;
  beforeMount: BeforeMount;
  onMount: OnMount;
  onChange: (value: string) => void;
  onSave: () => void;
};

class MonacoEditorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    reportMonacoRuntimeFailure(error, { phase: "editor" });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function MonacoFallbackEditor(props: {
  failure: MonacoRuntimeFailure | null;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3" data-testid="monaco-fallback-editor">
      <div className="flex items-start gap-2 text-xs text-muted" role="alert">
        <FileWarning className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <div className="font-medium text-foreground">
            <Trans>Code editor unavailable</Trans>
          </div>
          <div>
            <Trans>You can continue editing this file in plain text mode.</Trans>
          </div>
          {props.failure?.workerLabel ? (
            <div className="mt-1 font-mono text-[11px]">
              <Trans>Worker: {props.failure.workerLabel}</Trans>
            </div>
          ) : null}
        </div>
      </div>
      <textarea
        aria-label={t`Plain text editor fallback`}
        className="min-h-0 flex-1 resize-none rounded-md border border-[color:var(--border)] bg-[var(--content-background)] p-3 font-mono text-[13px] leading-5 text-foreground outline-none focus:border-primary"
        spellCheck={false}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            props.onSave();
          }
        }}
      />
    </div>
  );
}

export function MonacoEditorSurface(props: MonacoEditorSurfaceProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationFailure, setInitializationFailure] = useState<MonacoRuntimeFailure | null>(
    null,
  );
  const runtimeFailure = useSyncExternalStore(
    subscribeToMonacoRuntimeFailure,
    getMonacoRuntimeFailure,
    getMonacoRuntimeFailure,
  );

  useEffect(() => {
    let active = true;
    void initializeMonaco().then(
      () => {
        if (active) setIsInitialized(true);
      },
      () => {
        if (active) setInitializationFailure(getMonacoRuntimeFailure());
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const failure = runtimeFailure ?? initializationFailure;
  const fallback = (
    <MonacoFallbackEditor
      failure={failure}
      value={props.value}
      onChange={props.onChange}
      onSave={props.onSave}
    />
  );

  if (failure) return fallback;
  if (!isInitialized) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <Trans>Loading editor…</Trans>
      </div>
    );
  }

  return (
    <MonacoEditorBoundary fallback={fallback}>
      <Editor
        path={props.path}
        language={props.language}
        theme={props.theme}
        value={props.value}
        onChange={(value) => {
          if (value !== undefined) props.onChange(value);
        }}
        beforeMount={props.beforeMount}
        onMount={props.onMount}
        options={props.options}
      />
    </MonacoEditorBoundary>
  );
}
