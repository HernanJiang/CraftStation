import { useState } from "react";
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { useAppStore } from "@/renderer/state/appStore";
import { remoteOwner } from "@/renderer/state/remoteProjection";
import { friendlyError } from "@/shared/messages";
import type { WebChatSession } from "@/shared/chatGptWeb";
import { openWebChatForLocalThread } from "@/renderer/actions/webChatActions";

export function WebChatThreadSidebarDialog({
  session,
  onClose,
}: {
  session: WebChatSession;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const choices = threads
    .filter((thread) => !thread.archived && !remoteOwner(thread))
    .map((thread) => ({
      thread,
      project: projects.find((project) => project.id === thread.projectId)?.name ?? "",
    }))
    .filter(({ thread, project }) =>
      `${thread.title} ${project}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
  return (
    <Modal.Backdrop
      isOpen
      isDismissable={!pending}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="w-full max-w-lg" data-testid="webchat-thread-sidebar-dialog">
          <Modal.Header>
            <Modal.Heading>
              <Trans>选择已有本地对话</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-3">
            <p className="text-sm text-muted">
              <Trans>选择对话后，在其右侧打开当前网页。</Trans>
            </p>
            <input
              aria-label={t`搜索对话`}
              placeholder={t`搜索对话`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-border bg-default px-3 py-2 text-sm"
            />
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {choices.map(({ thread, project }) => (
                <Button
                  key={thread.id}
                  variant="ghost"
                  className="h-auto w-full justify-start px-3 py-2 text-left"
                  data-webchat-local-thread={thread.id}
                  isDisabled={Boolean(pending)}
                  isPending={pending === thread.id}
                  onPress={() => {
                    setPending(thread.id);
                    setError(undefined);
                    void openWebChatForLocalThread(session, thread.id)
                      .then(onClose)
                      .catch((cause) => {
                        setError(friendlyError(cause));
                        setPending(undefined);
                      });
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{thread.title}</span>
                    <span className="block truncate text-xs text-muted">{project}</span>
                  </span>
                </Button>
              ))}
              {!choices.length && (
                <p className="py-5 text-center text-sm text-muted">
                  <Trans>暂无可用的本地对话</Trans>
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" isDisabled={Boolean(pending)} onPress={onClose}>
              <Trans>取消</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
