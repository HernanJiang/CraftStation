import {
  memo,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "@heroui/react";
import { Check, ChevronLeft, ChevronRight, Copy, X, ZoomIn, ZoomOut } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { friendlyError } from "@/shared/messages";
import { copyImageSourceToClipboard } from "../thread/ChatPane/parts/items/imageClipboard";
import { attachmentImageUrl, type Attachment } from "./useAttachments";
import { PREVIEW_MIN_SCALE, PREVIEW_MAX_SCALE, usePreviewZoom } from "../common/usePreviewZoom";

/** A pre-resolved image for the lightbox: a renderable URL plus an accessible label. */
export interface LightboxImage {
  /** Renderable image URL — a `data:`, `craftstation-local://`, or remote URL. */
  src: string;
  /** Accessible label / alt text. */
  alt?: string;
}

type LightboxState = {
  images: readonly LightboxImage[];
  initialIndex: number;
  nonce: number;
};

type Point = { x: number; y: number };

const SCALE_STEP = 0.5;

let lightboxState: LightboxState | null = null;
let lightboxNonce = 0;
const lightboxListeners = new Set<() => void>();

function emitLightboxChange() {
  for (const listener of lightboxListeners) listener();
}

function subscribeLightbox(listener: () => void): () => void {
  lightboxListeners.add(listener);
  return () => {
    lightboxListeners.delete(listener);
  };
}

function getLightboxSnapshot(): LightboxState | null {
  return lightboxState;
}

export function openImageLightbox(images: readonly LightboxImage[], initialIndex: number): void {
  if (images.length === 0) return;
  lightboxState = {
    images: [...images],
    initialIndex: Math.min(Math.max(0, initialIndex), images.length - 1),
    nonce: ++lightboxNonce,
  };
  emitLightboxChange();
}

export function openAttachmentLightbox(
  attachments: readonly Attachment[],
  initialIndex: number,
  imageUrlForPath?: (path: string) => string,
): void {
  openImageLightbox(
    attachments.map((img) => ({
      src: attachmentImageUrl(img, imageUrlForPath),
      alt: img.name,
    })),
    initialIndex,
  );
}

export function closeImageLightbox(): void {
  if (lightboxState === null) return;
  lightboxState = null;
  emitLightboxChange();
}

export const ImageLightboxHost = memo(function ImageLightboxHost() {
  const state = useSyncExternalStore(subscribeLightbox, getLightboxSnapshot, getLightboxSnapshot);
  useEffect(() => closeImageLightbox, []);
  if (!state) return null;
  return (
    <ImageLightboxView
      key={state.nonce}
      images={state.images}
      initialIndex={state.initialIndex}
      onClose={closeImageLightbox}
    />
  );
});

/**
 * Source-agnostic fullscreen image viewer. Accepts already-resolved image URLs
 * (`data:`, `craftstation-local://`, remote) so it can be reused for chat-generated
 * images as well as composer attachments. Supports keyboard nav and prev/next
 * chrome for multi-image galleries; a single image renders without that chrome.
 */
export function ImageLightboxView(props: {
  images: readonly LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { images, initialIndex, onClose } = props;
  const [index, setIndex] = useState(initialIndex);
  const zoom = usePreviewZoom<HTMLImageElement>(index);
  const { scale, stageRef, contentRef: imageRef } = zoom;
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<Point | null>(null);
  const current = images[index];

  // Reset index if initialIndex changes (new lightbox open)
  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setCopied(false);
    setMenu(null);
  }, [index]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
        } else {
          onClose();
        }
      } else if (e.key === "ArrowLeft") {
        setIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
      } else if (e.key === "ArrowRight") {
        setIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, images.length, menu]);

  useEffect(() => {
    if (!menu) return;
    function dismiss() {
      setMenu(null);
    }
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [menu]);

  if (!current) return null;

  async function copyCurrentImage() {
    if (!current) return;
    try {
      const ok = await copyImageSourceToClipboard({ src: current.src });
      if (!ok) {
        toast.danger(t`Clipboard rejected the image (unsupported format)`);
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy image to clipboard", err);
      toast.danger(friendlyError(err));
    }
  }

  function handleImageContextMenu(event: ReactMouseEvent<HTMLImageElement>) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  }

  return createPortal(
    <div // eslint-disable-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-dismiss is mouse-only by design; Escape (handled via the useEffect above) is the keyboard equivalent
      className="craftstation-image-lightbox"
      onClick={(event) => {
        const target = event.target;
        if (
          target === event.currentTarget ||
          (target instanceof HTMLElement &&
            target.classList.contains("craftstation-image-lightbox__stage"))
        ) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt ?? t`Image preview`}
    >
      <button
        type="button"
        className="craftstation-image-lightbox__close"
        aria-label={t`Close preview`}
        onClick={onClose}
      >
        <X className="size-5" />
      </button>

      {images.length > 1 ? (
        <button
          type="button"
          className="craftstation-image-lightbox__nav craftstation-image-lightbox__nav--prev"
          aria-label={t`Previous image`}
          onClick={(e) => {
            e.stopPropagation();
            setIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
          }}
        >
          <ChevronLeft className="size-6" />
        </button>
      ) : null}

      <div ref={stageRef} className="craftstation-image-lightbox__stage">
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the image supports pointer-drag panning; keyboard image navigation remains on the dialog */}
        <img
          ref={imageRef}
          className={`craftstation-image-lightbox__image${scale > 1 ? " craftstation-image-lightbox__image--zoomed" : ""}`}
          src={current.src}
          alt={current.alt ?? ""}
          style={{
            transform: zoom.transform,
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={handleImageContextMenu}
          {...zoom.pointerHandlers}
          decoding="async"
          draggable={false}
        />
      </div>

      {images.length > 1 ? (
        <button
          type="button"
          className="craftstation-image-lightbox__nav craftstation-image-lightbox__nav--next"
          aria-label={t`Next image`}
          onClick={(e) => {
            e.stopPropagation();
            setIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
          }}
        >
          <ChevronRight className="size-6" />
        </button>
      ) : null}

      <div className="craftstation-image-lightbox__footer">
        <div className="craftstation-image-lightbox__zoom">
          <button
            type="button"
            className="craftstation-image-lightbox__zoom-button"
            aria-label={copied ? t`Copied` : t`Copy image`}
            disabled={!current}
            onClick={(event) => {
              event.stopPropagation();
              void copyCurrentImage();
            }}
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
          <button
            type="button"
            className="craftstation-image-lightbox__zoom-button"
            aria-label={t`Zoom out`}
            disabled={scale <= PREVIEW_MIN_SCALE}
            onClick={(event) => {
              event.stopPropagation();
              zoom.zoomBy(-SCALE_STEP);
            }}
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            className="craftstation-image-lightbox__zoom-value"
            aria-label={t`Reset zoom`}
            title={t`Reset zoom`}
            onClick={zoom.reset}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="craftstation-image-lightbox__zoom-button"
            aria-label={t`Zoom in`}
            disabled={scale >= PREVIEW_MAX_SCALE}
            onClick={(event) => {
              event.stopPropagation();
              zoom.zoomBy(SCALE_STEP);
            }}
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
        {images.length > 1 ? (
          <span className="craftstation-image-lightbox__counter">
            {index + 1} / {images.length}
          </span>
        ) : null}
      </div>

      {menu ? (
        <div
          className="craftstation-image-lightbox__context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="craftstation-image-lightbox__context-menu-item"
            onClick={() => {
              setMenu(null);
              void copyCurrentImage();
            }}
          >
            <Copy className="size-4" />
            {t`Copy image`}
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
