import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

type OfficeState =
  | { status: "loading" }
  | { status: "ready"; text: string; truncated: boolean }
  | { status: "error"; message: string };

/**
 * Plain-text preview of docx/xlsx/pptx via main-process extraction. Tables,
 * images and formatting are dropped by design — full fidelity stays with
 * the OS default app, one click away.
 */
export function OfficePreview(props: { path: string; projectLocation: ProjectLocation }) {
  const { t } = useLingui();
  const [state, setState] = useState<OfficeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void readBridge()
      .extractOfficeDocumentText({ projectLocation: props.projectLocation, path: props.path })
      .then((result) => {
        if (!cancelled) setState({ status: "ready", text: result.text, truncated: result.truncated });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.path, props.projectLocation]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted">
        <Trans>Extracting document text…</Trans>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted">
        <p className="text-xs whitespace-pre-wrap text-danger">{state.message}</p>
        <button
          type="button"
          className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-foreground transition-colors hover:bg-[var(--row-hover)]"
          onClick={() => {
            readBridge()
              .openProjectEntryWithSystem({ projectLocation: props.projectLocation, path: props.path })
              .catch(() => {});
          }}
        >
          {t`Open With System Default`}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <p className="shrink-0 border-b border-[color:var(--border)] px-4 py-1.5 text-xs text-muted">
        <Trans>Text-only preview — formatting and images are omitted.</Trans>
      </p>
      <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground">
        {state.text.length > 0 ? state.text : t`No extractable text in this document.`}
      </pre>
      {state.truncated ? (
        <p className="shrink-0 border-t border-[color:var(--border)] px-4 py-1.5 text-xs text-muted">
          <Trans>Preview truncated — open the file for the full text.</Trans>
        </p>
      ) : null}
    </div>
  );
}
