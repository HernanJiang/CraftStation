import { readBridge } from "@/renderer/bridge";

/**
 * Shared image → clipboard helpers for image cards and the fullscreen
 * lightbox. The native clipboard (Electron `nativeImage`) only decodes
 * PNG/JPEG, so other raster formats are decoded and re-encoded to PNG when
 * possible.
 */

export async function fetchImageBytes(src: string): Promise<Uint8Array<ArrayBuffer>> {
  if (/^craftstation-local:\/\//.test(src)) {
    return new Uint8Array(await readBridge().readLocalImageFile({ url: src }));
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to load image (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Bytes to hand the OS clipboard; PNG/JPEG pass straight through. */
export async function toClipboardPngBytes(source: {
  src: string;
  mime?: string;
}): Promise<Uint8Array<ArrayBuffer>> {
  if (source.mime === "image/png" || source.mime === "image/jpeg") {
    return fetchImageBytes(source.src);
  }
  try {
    const blob = await (await fetch(source.src)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return fetchImageBytes(source.src);
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!pngBlob) return fetchImageBytes(source.src);
    return new Uint8Array(await pngBlob.arrayBuffer());
  } catch {
    return fetchImageBytes(source.src);
  }
}

/** Copy an image source to the OS clipboard. False = the clipboard rejected it. */
export async function copyImageSourceToClipboard(source: {
  src: string;
  mime?: string;
}): Promise<boolean> {
  const data = await toClipboardPngBytes(source);
  const ok = await readBridge().copyImageToClipboard({ data });
  if (!ok) {
    console.warn("Clipboard rejected the image (unsupported format)");
  }
  return ok;
}
