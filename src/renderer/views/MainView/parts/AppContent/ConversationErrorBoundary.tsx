import { Component, type ErrorInfo, type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";

type ConversationErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type ConversationErrorBoundaryState = {
  error: unknown | null;
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
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<ConversationErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ConversationErrorBoundaryProps,
    state: ConversationErrorBoundaryState,
  ): Partial<ConversationErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[conversation-error-boundary] Conversation view failed", error, info);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error === null) return this.props.children;

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
