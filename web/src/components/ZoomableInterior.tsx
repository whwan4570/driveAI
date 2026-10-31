import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Point = { x: number; y: number };
type View = { scale: number; x: number; y: number };
type Pinch = { distance: number; center: Point; view: View };

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ZoomableInterior({ src, alt }: { src: string; alt: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const lastPointerRef = useRef<Point | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const [view, setView] = useState<View>(viewRef.current);

  const updateView = (next: View) => {
    const viewport = viewportRef.current;
    const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
    const maxX = viewport ? viewport.clientWidth * (scale - 1) / 2 : 0;
    const maxY = viewport ? viewport.clientHeight * (scale - 1) / 2 : 0;
    const clamped = { scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
    viewRef.current = clamped;
    setView(clamped);
  };

  const zoomTo = (scale: number, point?: Point) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const current = viewRef.current;
    const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE);
    const ratio = nextScale / current.scale;
    const center = point ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    updateView({ scale: nextScale,
      x: ratio * current.x + (1 - ratio) * (center.x - viewport.clientWidth / 2),
      y: ratio * current.y + (1 - ratio) * (center.y - viewport.clientHeight / 2) });
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoomTo(viewRef.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15),
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    lastPointerRef.current = point;
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: distance(a, b), center: midpoint(a, b), view: viewRef.current };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const center = midpoint(a, b);
      const start = pinchRef.current;
      const scale = clamp(start.view.scale * distance(a, b) / Math.max(1, start.distance), MIN_SCALE, MAX_SCALE);
      const ratio = scale / start.view.scale;
      const viewport = viewportRef.current;
      if (viewport) updateView({ scale,
        x: ratio * start.view.x + center.x - start.center.x + (1 - ratio) * (start.center.x - viewport.getBoundingClientRect().left - viewport.clientWidth / 2),
        y: ratio * start.view.y + center.y - start.center.y + (1 - ratio) * (start.center.y - viewport.getBoundingClientRect().top - viewport.clientHeight / 2) });
    } else if (viewRef.current.scale > 1 && lastPointerRef.current) {
      updateView({ ...viewRef.current, x: viewRef.current.x + point.x - lastPointerRef.current.x,
        y: viewRef.current.y + point.y - lastPointerRef.current.y });
    }
    lastPointerRef.current = point;
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    lastPointerRef.current = pointersRef.current.values().next().value ?? null;
  };

  return <div className="status-interior-view">
    <div ref={viewportRef} className={`status-interior-image-viewport${view.scale > 1 ? " is-zoomed" : ""}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onDoubleClick={() => zoomTo(viewRef.current.scale === 1 ? 2 : 1)}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}/>
    </div>
    <div className="status-interior-zoom-controls" role="group" aria-label="Interior photo zoom">
      <button type="button" aria-label="Zoom out" disabled={view.scale <= MIN_SCALE} onClick={() => zoomTo(viewRef.current.scale / 1.5)}>−</button>
      <button type="button" aria-label="Reset zoom" disabled={view.scale <= MIN_SCALE} onClick={() => zoomTo(1)}>{Math.round(view.scale * 100)}%</button>
      <button type="button" aria-label="Zoom in" disabled={view.scale >= MAX_SCALE} onClick={() => zoomTo(viewRef.current.scale * 1.5)}>+</button>
    </div>
  </div>;
}
