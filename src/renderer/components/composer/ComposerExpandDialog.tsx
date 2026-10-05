import { useEffect, useRef, useState } from "react";
import { Modal } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { Send } from "lucide-react";
import type { ProjectLocation, PromptSegment } from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";
import {
  MentionInput,
  type McpMentionItem,
  type MentionInputHandle,
  type PluginMentionItem,
} from "./MentionInput";
import { flattenSegments } from "./serializeMentions";

/**
 * Expanded composer: the chat input opens in a modal-sized Markdown editor
 * where Enter inserts a newline instead of submitting (Ctrl/Cmd+Enter or the
 * Send button submits). Content syncs both ways — seeded from the composer on
 * open, written back into it on close.
 */
export function ComposerExpandDialog(props: {
  isOpen: boolean;
  placeholder: string;
  projectLocation: ProjectLocation | undefined;
  projectId?: string;
  mcpMentions?: readonly McpMentionItem[];
  pluginMentions?: readonly PluginMentionItem[];
  onPasteImage?: (file: File) => void;
  submitDisabled?: boolean;
  /** Segments captured from the composer at the moment the dialog opened. */
  initialSegments: PromptSegment[];
  /** Called on every close (Esc, backdrop, Collapse); carries the edited segments. */
  onClose: (segments: PromptSegment[]) => void;
  onSubmit: (segments: PromptSegment[]) => void;
}) {
  const editorRef = useRef<MentionInputHandle>(null);
  const [hasText, setHasText] = useState(false);

  // The editor mounts lazily with the modal; defer a frame so the ref is
  // attached before restoring the seed content.
  useEffect(() => {
    if (!props.isOpen) return;
    const raf = requestAnimationFrame(() => {
      editorRef.current?.restoreFromSegments(props.initialSegments);
      setHasText(flattenSegments(props.initialSegments).length > 0);
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialSegments is a per-open seed, not a live binding
  }, [props.isOpen]);

  function close() {
    props.onClose(editorRef.current?.serializeSegments() ?? []);
  }

  function submit() {
    if (props.submitDisabled === true) return;
    const segments = editorRef.current?.serializeSegments() ?? [];
    if (flattenSegments(segments).length === 0) return;
    // Clear before onSubmit so the modal-close write-back doesn't resurrect
    // the submitted text in the composer.
    editorRef.current?.clear();
    props.onSubmit(segments);
  }

  return (
    <Modal.Backdrop
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[820px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>Edit message</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 pb-5 pt-2">
            <div className="craftstation-composer-expanded rounded-lg border border-border">
              <MentionInput
                ref={editorRef}
                placeholder={props.placeholder}
                projectLocation={props.projectLocation}
                {...(props.projectId ? { projectId: props.projectId } : {})}
                {...(props.mcpMentions ? { mcpMentions: props.mcpMentions } : {})}
                {...(props.pluginMentions ? { pluginMentions: props.pluginMentions } : {})}
                {...(props.onPasteImage ? { onPasteImage: props.onPasteImage } : {})}
                submitOnEnter={false}
                onTextChange={setHasText}
                onSubmit={submit}
                onInterceptKey={(e) => {
                  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "Enter") {
                    e.preventDefault();
                    submit();
                    return true;
                  }
                  return false;
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              <Trans>Enter inserts a newline · Ctrl+Enter sends</Trans>
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Collapse</Trans>
            </Button>
            <Button
              variant="primary"
              isDisabled={!hasText || props.submitDisabled === true}
              onPress={submit}
            >
              <Send className="size-3.5" />
              <Trans>Send</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
