import type { ReactNode } from "react";
import { Tooltip } from "@heroui/react";
import { Monitor, TriangleAlert, X } from "lucide-react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { isRemoteSession } from "@/renderer/bridge";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { isModelSupportedImagePath, isPdfPath } from "@/shared/promptContent";
import type { ComposerMcpServerDescriptor } from "./composerMcpServers";
import { attachmentImageUrl, type Attachment } from "./useAttachments";

/**
 * Enabled-MCP indicator, parameterized by a {@link ComposerMcpServerDescriptor}
 * from the composer MCP registry so adding a new MCP needs no new chip code.
 *
 * - `chip` (default): a removable pill in the composer attachment bar.
 * - `header`: a non-interactive status icon in the active-thread header. The
 *   MCP server set is bound at session-create time, so a mid-thread change
 *   can't reconfigure the running session — the icon is informational only, but
 *   rendered as a <button> to match the sibling header status controls.
 */
/** The subset of a composer MCP descriptor the chip actually renders. */
type McpChipDescriptor = Pick<
  ComposerMcpServerDescriptor,
  "icon" | "label" | "enabledTitle" | "disableLabel"
>;

export function McpChip(props: {
  descriptor: McpChipDescriptor;
  onRemove?: (() => void) | undefined;
  title?: string;
  variant?: "chip" | "header";
}) {
  const { t } = useLingui();
  const { descriptor, onRemove, variant = "chip" } = props;
  const Icon = descriptor.icon;
  const title = props.title ?? t(descriptor.enabledTitle);
  if (variant === "header") {
    return (
      <Tooltip delay={0}>
        <Tooltip.Trigger>
          <button
            type="button"
            className="craftstation-overlay-header__controls shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content>{title}</Tooltip.Content>
      </Tooltip>
    );
  }
  return (
    <div
      className="craftstation-attachment-chip craftstation-browser-chip"
      title={title}
      aria-label={title}
      role={onRemove ? "group" : "img"}
    >
      <Icon className="size-3 text-muted" aria-hidden="true" />
      <span className="craftstation-attachment-chip__name">{t(descriptor.label)}</span>
      {onRemove ? (
        <button
          type="button"
          className="craftstation-attachment-chip__delete"
          aria-label={t(descriptor.disableLabel)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-2" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Computer Use is not a composer MCP registry entry (its gating lives in
 * `getComputerUseScope`), but its chip renders through {@link McpChip} with a
 * descriptor-shaped constant so there is a single chip implementation.
 */
const computerUseChipDescriptor: McpChipDescriptor = {
  icon: Monitor,
  label: msg`Computer Use`,
  enabledTitle: msg`Computer Use enabled — interactive actions take over the desktop; don't use the machine while the agent is controlling it`,
  disableLabel: msg`Disable Computer Use`,
};

export function ComputerUseChip(props: {
  onRemove?: (() => void) | undefined;
  title?: string;
  variant?: "chip" | "header";
}) {
  const { t } = useLingui();
  // Interactive actions steal the real mouse/keyboard on the host desktop —
  // including when driving from a paired phone.
  const title =
    props.title ??
    (isRemoteSession()
      ? t`Computer Use enabled — controls the paired desktop; don't use that machine while the agent is controlling it`
      : t`Computer Use enabled — interactive actions take over the desktop; don't use the machine while the agent is controlling it`);
  return (
    <McpChip
      descriptor={computerUseChipDescriptor}
      onRemove={props.onRemove}
      title={title}
      {...(props.variant !== undefined ? { variant: props.variant } : {})}
    />
  );
}

function AttachmentChip(props: {
  attachment: Attachment;
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: ((attachment: Attachment) => void) | undefined;
  onPreviewPdf?: ((attachment: Attachment) => void) | undefined;
  hideImageName?: boolean;
  imageUrlForPath?: ((path: string) => string) | undefined;
}) {
  const { t } = useLingui();
  const {
    attachment: att,
    onRemove,
    onPreviewImage,
    onPreviewPdf,
    hideImageName,
    imageUrlForPath,
  } = props;
  const isPicked = !!att.selector;
  const labelText = isPicked ? att.selector! : att.name;
  const showLabel = isPicked || !att.isImage || !hideImageName;
  // Side-pane preview supports more image formats than models accept — flag
  // those so a successful preview is never mistaken for model support.
  const showModelFormatWarning =
    !isPicked && att.isImage && !isModelSupportedImagePath(att.name, att.mimeType);
  const tooltip = isPicked
    ? att.sourceUrl
      ? `${att.selector}\n${att.sourceUrl}`
      : att.selector
    : undefined;
  const labelClass = isPicked
    ? "craftstation-attachment-chip__name craftstation-attachment-chip__selector"
    : "craftstation-attachment-chip__name";

  const content = (
    <>
      {att.isImage ? (
        <img
          className="craftstation-attachment-chip__thumb"
          src={attachmentImageUrl(att, imageUrlForPath)}
          alt={att.name}
          decoding="async"
          draggable={false}
        />
      ) : (
        <img
          className="craftstation-attachment-chip__icon"
          src={getEntryIconUrl(att.name, false)}
          alt=""
          draggable={false}
        />
      )}
      {showLabel ? (
        <span className={labelClass} {...(tooltip ? { title: tooltip } : {})}>
          {labelText}
        </span>
      ) : null}
      {showModelFormatWarning ? (
        <span
          className="shrink-0 text-amber-400"
          title={t`Previewable here, but models may not accept this image format (use png, jpg, gif or webp)`}
          aria-label={t`Image format may not be supported by the model`}
          role="img"
        >
          <TriangleAlert className="size-3" aria-hidden="true" />
        </span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="craftstation-attachment-chip__delete"
          aria-label={t`Remove ${att.name}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(att.id);
          }}
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </>
  );

  const onPreview = att.isImage
    ? onPreviewImage
    : isPdfPath(att.path, att.mimeType)
      ? onPreviewPdf
      : undefined;
  if (onPreview) {
    return (
      <div
        className="craftstation-attachment-chip"
        role="button"
        tabIndex={0}
        aria-label={t`Preview ${att.name}`}
        onClick={() => onPreview(att)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPreview(att);
          }
        }}
      >
        {content}
      </div>
    );
  }

  return <div className="craftstation-attachment-chip">{content}</div>;
}

function ImagePreview(props: {
  attachment: Attachment;
  onPreviewImage?: ((attachment: Attachment) => void) | undefined;
  imageUrlForPath?: ((path: string) => string) | undefined;
}) {
  const { t } = useLingui();
  const { attachment: att, onPreviewImage, imageUrlForPath } = props;
  const img = (
    <img
      src={attachmentImageUrl(att, imageUrlForPath)}
      alt={att.name}
      decoding="async"
      draggable={false}
    />
  );
  if (onPreviewImage) {
    return (
      <button
        type="button"
        className="craftstation-attachment-image-preview"
        data-craftstation-attachment-image-preview="true"
        onClick={() => onPreviewImage(att)}
        aria-label={t`Preview ${att.name}`}
      >
        {img}
      </button>
    );
  }
  return (
    <span
      className="craftstation-attachment-image-preview"
      data-craftstation-attachment-image-preview="true"
    >
      {img}
    </span>
  );
}

export function AttachmentBar(props: {
  attachments: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: (attachment: Attachment) => void;
  onPreviewPdf?: (attachment: Attachment) => void;
  layout?: "inset" | "flush";
  hideImageNames?: boolean;
  imagesAsPreview?: boolean;
  imageUrlForPath?: (path: string) => string;
  leading?: ReactNode;
}) {
  const {
    attachments,
    onRemove,
    onPreviewImage,
    onPreviewPdf,
    layout = "inset",
    hideImageNames,
    imagesAsPreview,
    imageUrlForPath,
    leading,
  } = props;
  if (attachments.length === 0 && !leading) return null;

  const className =
    layout === "inset"
      ? "craftstation-attachment-bar craftstation-attachment-bar--inset"
      : "craftstation-attachment-bar";

  return (
    <div className={className}>
      {leading}
      {attachments.map((att) =>
        imagesAsPreview && att.isImage && !att.selector ? (
          <ImagePreview
            key={att.id}
            attachment={att}
            onPreviewImage={onPreviewImage}
            imageUrlForPath={imageUrlForPath}
          />
        ) : (
          <AttachmentChip
            key={att.id}
            attachment={att}
            onRemove={onRemove}
            onPreviewImage={onPreviewImage}
            onPreviewPdf={onPreviewPdf}
            imageUrlForPath={imageUrlForPath}
            {...(hideImageNames === undefined ? {} : { hideImageName: hideImageNames })}
          />
        ),
      )}
    </div>
  );
}
