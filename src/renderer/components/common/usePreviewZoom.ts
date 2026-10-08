import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export const PREVIEW_MIN_SCALE = 0.25;
export const PREVIEW_MAX_SCALE = 4;

type Point = { x: number; y: number };
type View = { scale: number; pan: Point };
const initialView: View = { scale: 1, pan: { x: 0, y: 0 } };

/** Zoom a centered preview around the pointer without scrolling or zooming the app. */
export function usePreviewZoom<T extends HTMLElement>(resetKey: unknown, startAtTop = false) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<T>(null);
  const [view, setView] = useState(initialView);
  const viewRef = useRef(initialView);
  const interactedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    start: Point;
    pan: Point;
  } | null>(null);

  const updateView = useCallback((next: View) => {
    const stage = stageRef.current;
    const content = contentRef.current;
    const maxX = Math.max(
      0,
      ((content?.clientWidth ?? 0) * next.scale - (stage?.clientWidth ?? 0)) / 2,
    );
    const maxY = Math.max(
      0,
      ((content?.clientHeight ?? 0) * next.scale - (stage?.clientHeight ?? 0)) / 2,
    );
    const bounded = {
      scale: next.scale,
      pan: {
        x: Math.min(maxX, Math.max(-maxX, next.pan.x)),
        y: Math.min(maxY, Math.max(-maxY, next.pan.y)),
      },
    };
    viewRef.current = bounded;
    setView(bounded);
  }, []);

  const reset = useCallback(() => {
    dragRef.current = null;
    interactedRef.current = false;
    updateView({ scale: 1, pan: { x: 0, y: startAtTop ? Number.MAX_SAFE_INTEGER : 0 } });
  }, [startAtTop, updateView]);

  useEffect(reset, [resetKey, reset]);

  const zoomTo = useCallback(
    (requested: number, anchor: Point = { x: 0, y: 0 }) => {
      const current = viewRef.current;
      const scale = Math.min(PREVIEW_MAX_SCALE, Math.max(PREVIEW_MIN_SCALE, requested));
      const ratio = scale / current.scale;
      interactedRef.current = true;
      dragRef.current = null;
      updateView({
        scale,
        pan: {
          x: anchor.x - (anchor.x - current.pan.x) * ratio,
          y: anchor.y - (anchor.y - current.pan.y) * ratio,
        },
      });
    },
    [updateView],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function handleWheel(event: WheelEvent) {
      if (!stage || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = stage.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const delta = Math.min(200, Math.max(-200, event.deltaY * unit));
      zoomTo(viewRef.current.scale * Math.exp(-delta * 0.002), {
        x: ((event.clientX - rect.left - rect.width / 2) * stage.clientWidth) / (rect.width || 1),
        y: ((event.clientY - rect.top - rect.height / 2) * stage.clientHeight) / (rect.height || 1),
      });
    }
    // React delegates wheel events passively; a native listener can cancel scrolling.
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [zoomTo]);

  useEffect(() => {
    const clamp = () => (interactedRef.current ? updateView(viewRef.current) : reset());
    window.addEventListener("resize", clamp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clamp);
    if (stageRef.current) observer?.observe(stageRef.current);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      window.removeEventListener("resize", clamp);
      observer?.disconnect();
    };
  }, [reset, updateView]);

  function onPointerDown(event: PointerEvent<T>) {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    const content = contentRef.current;
    if (
      !stage ||
      !content ||
      (content.clientWidth * viewRef.current.scale <= stage.clientWidth &&
        content.clientHeight * viewRef.current.scale <= stage.clientHeight)
    )
      return;
    interactedRef.current = true;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pan: viewRef.current.pan,
    };
  }

  function onPointerMove(event: PointerEvent<T>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !stage) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    updateView({
      scale: viewRef.current.scale,
      pan: {
        x:
          drag.pan.x +
          ((event.clientX - drag.start.x) * stage.clientWidth) /
            (rect.width || stage.clientWidth || 1),
        y:
          drag.pan.y +
          ((event.clientY - drag.start.y) * stage.clientHeight) /
            (rect.height || stage.clientHeight || 1),
      },
    });
  }

  function onPointerEnd(event: PointerEvent<T>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  return {
    stageRef,
    contentRef,
    scale: view.scale,
    transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.scale})`,
    zoomBy: (delta: number) => zoomTo(viewRef.current.scale + delta),
    reset,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
    },
  };
}
