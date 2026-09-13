import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Check, Copy, Download, Maximize2 } from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { readBridge } from "@/renderer/bridge";
import { openImageLightbox } from "@/renderer/components/composer/ImageLightbox";
import { friendlyError } from "@/shared/messages";
import { chatInlineImageClass, reserveInlineImageSlot } from "./chatImageClass";
import { copyImageSourceToClipboard, fetchImageBytes } from "./imageClipboard";
import type { ImageViewSource } from "./imageViewSource";

interface ImageCardProps {
  source: ImageViewSource;
  className?: string;
  imageClassName?: string;
  isBlock?: boolean;
}

/**
 * Shared interactive image used by tool results, message image blocks, and
 * markdown images. A span root keeps the card valid inside markdown paragraphs.
 */
export const ImageCard = memo(function ImageCard({
  source,
  className,
  imageClassName,
  isBlock = false,
}: ImageCardProps) {
  const { t } = useLingui();
  const imageAlt = source.alt || t`Image`;
  const openPreview = () => openImageLightbox([{ src: source.src, alt: imageAlt }], 0);
  // A `data:` source is already in hand, so it paints on the first frame; fading
  // it would only add perceived latency. Anything fetched over the network gets
  // the crossfade (and the blurred stand-in, when the host supplied one).
  const fadesIn = !source.src.startsWith("data:");
  const [loaded, setLoaded] = useState(!fadesIn);
  const showPreview = fadesIn && !loaded && Boolean(source.preview);
  // Reserve the final box up front so the transcript never reflows when a
  // fetched image lands. Inline `data:` images paint immediately and keep the
  // natural `w-auto` sizing.
  const reservedSlot = fadesIn ? reserveInlineImageSlot(source.width, source.height) : undefined;

  return (
    <span
      className={`craftstation-image-card relative self-start ${isBlock ? "flex w-fit" : "inline-flex"} max-w-full overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)]${className ? ` ${className}` : ""}`}
      data-craftstation-image-card="true"
    >
      <button
        type="button"
        className="relative block cursor-zoom-in bg-black/20"
        aria-label={t`Open image preview`}
        onClick={openPreview}
      >
        {/* Blurred stand-in for a host-held image, painted in the slot the <img>
            has already reserved via its intrinsic width/height. Scaled past the
            edges so the blur has no visible border, and dropped from the tree
            once the real image paints. Inline images are already decoded, so
            they skip the fade entirely and never flash. */}
        {showPreview ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 scale-110 bg-cover bg-center blur-lg"
            style={{ backgroundImage: `url("${source.preview!}")` }}
          />
        ) : null}
        <img
          src={source.src}
          alt={imageAlt}
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          {...(source.width && source.height ? { width: source.width, height: source.height } : {})}
          {...(reservedSlot ? { style: reservedSlot } : {})}
          className={`${chatInlineImageClass} relative${fadesIn ? ` transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}` : ""}${imageClassName ? ` ${imageClassName}` : ""}`}
        />
      </button>
      <span className="craftstation-image-action-toolbar absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-black/50 p-0.5 backdrop-blur-sm transition-opacity duration-150">
        <CopyImageButton source={source} />
        <DownloadImageButton src={source.src} fileName={source.fileName} />
        <IconButton label={t`Open preview`} onClick={openPreview}>
          <Maximize2 className="size-3.5" />
        </IconButton>
      </span>
    </span>
  );
});

function CopyImageButton({ source }: { source: ImageViewSource }) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      const ok = await copyImageSourceToClipboard(source);
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy image to clipboard", err);
      toast.danger(friendlyError(err));
    }
  }

  return (
    <IconButton label={copied ? t`Copied` : t`Copy image`} onClick={() => void onCopy()}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

function DownloadImageButton({ src, fileName }: { src: string; fileName: string }) {
  const { t } = useLingui();
  async function onDownload() {
    try {
      const data = await fetchImageBytes(src);
      await readBridge().saveImageFile({ data, suggestedName: fileName });
    } catch (err) {
      console.error("Failed to save image", err);
      toast.danger(friendlyError(err));
    }
  }

  return (
    <IconButton label={t`Download image`} onClick={() => void onDownload()}>
      <Download className="size-3.5" />
    </IconButton>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
