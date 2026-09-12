import { Component, type ErrorInfo, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";

type ConversationErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type ConversationErrorBoundaryState = {
  error: unknown | null;
  componentStack: string | null;
  resetKey: string;
};

/**
 * Keeps a failure inside the conversation surface from unmounting the whole
 * desktop workspace. Changing conversations resets the boundary automatically;
 * the retry action covers transient render failures without changing routes.
 */
export class ConversationErrorBoundary extends Component<
  ConversationErrorBoundaryProps,
  ConversationErrorBoundaryState
> {
  override state: ConversationErrorBoundaryState;

  constructor(props: ConversationErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<ConversationErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ConversationErrorBoundaryProps,
    state: ConversationErrorBoundaryState,
  ): Partial<ConversationErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, componentStack: null, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[conversation-error-boundary] Conversation view failed", error, info);
    const componentStack = typeof info?.componentStack === "string" ? info.componentStack : null;
    if (componentStack) this.setState({ componentStack });
  }

  private retry = () => {
    this.setState({ error: null, componentStack: null });
  };

  override render() {
    if (this.state.error === null) return this.props.children;

    // Never render a dead-end card: the raw error is the only lead for the
    // actual render defect, so surface a truncated message plus the active
    // conversation key. Truncation keeps huge component trees / secrets out
    // of the fallback UI; the full error stays in the console.
    const message = describeConversationRenderError(this.state.error);

    return (
      <div
        data-conversation-error-boundary=""
        role="alert"
        className="flex h-full min-h-0 items-center justify-center px-6 text-center"
      >
        <div className="max-w-md rounded-xl border border-[var(--hairline)] bg-[var(--surface-secondary)] px-5 py-4">
          <p className="text-sm font-medium text-foreground">
            <Trans>Conversation view failed to render.</Trans>
          </p>
          <p className="mt-1 text-xs text-muted">
            <Trans>
              The active session is still available. Retry this view or open another session.
            </Trans>
          </p>
          <p
            data-testid="conversation-error-message"
            className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-black/30 px-2.5 py-1.5 text-left font-mono text-[11px] leading-4 break-all text-foreground select-text"
          >
            {message}
          </p>
          <p className="mt-1.5 truncate text-[11px] text-muted" title={this.props.resetKey}>
            {this.props.resetKey}
          </p>
          {import.meta.env.DEV && this.state.componentStack ? (
            <details className="mt-2 text-left">
              <summary className="cursor-pointer text-[11px] text-muted">
                <Trans>Component stack</Trans>
              </summary>
              <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[10px] leading-4 break-all whitespace-pre-wrap text-muted select-text">
                {this.state.componentStack.trim().slice(0, 2000)}
              </pre>
            </details>
          ) : null}
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--row-active)] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)]"
            onClick={this.retry}
          >
            <Trans>Retry</Trans>
          </button>
        </div>
      </div>
    );
  }
}

const CONVERSATION_RENDER_ERROR_LIMIT = 300;

function describeConversationRenderError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message || error.name || "Unknown render error";
  } else {
    try {
      raw = String(error);
    } catch {
      raw = "Unknown render error";
    }
  }
  const trimmed = raw.trim() || "Unknown render error";
  return trimmed.length > CONVERSATION_RENDER_ERROR_LIMIT
    ? `${trimmed.slice(0, CONVERSATION_RENDER_ERROR_LIMIT)}…`
    : trimmed;
}
