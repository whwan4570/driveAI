import { useEffect, useRef } from "react";

type Point = [number, number, number, number, number, number];

// A small point cloud sampled from the bundled demo model. Canvas avoids mobile video autoplay restrictions.
export function VehicleLoading() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const abort = new AbortController();
    let points: Point[] = [];
    let frame = 0;
    let lastDraw = 0;
    let width = 0;
    let height = 0;
    let disposed = false;

    const draw = (time: number) => {
      if (disposed || !width || !height) return;
      ctx.clearRect(0, 0, width, height);
      const phase = motion.matches ? 0 : time / 1000;
      const angle = 0.8 + Math.sin(phase * 0.34) * 0.1;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const scale = Math.min(width * 0.95, height * 1.72);
      for (let i = 0; i < points.length; i++) {
        const [x, y, z, nx, ny, nz] = points[i];
        const px = x * cos - z * sin;
        const depth = x * sin + z * cos;
        const py = -y * 0.94 + depth * 0.34;
        const facing = Math.max(0, nx * 0.35 + ny * 0.65 - nz * 0.48);
        const shimmer = motion.matches ? 0.5 : 0.5 + 0.5 * Math.sin(phase * 2.2 + z * 12 + i * 0.13);
        const alpha = Math.min(0.95, 0.22 + facing * 0.36 + shimmer * 0.27);
        const radius = 0.55 + facing * 0.55 + shimmer * 0.25;
        ctx.fillStyle = `rgba(${Math.round(72 + facing * 135)}, ${Math.round(164 + facing * 80)}, ${Math.round(189 + facing * 60)}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(width * 0.5 + px * scale, height * 0.46 + py * scale, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const tick = (time: number) => {
      if (disposed || motion.matches || document.hidden) return;
      if (time - lastDraw >= 40) { draw(time); lastDraw = time; }
      frame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
      if (!motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      refresh();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    fetch("/carmori-car-points.json", { signal: abort.signal })
      .then((response) => { if (!response.ok) throw new Error("Point cloud unavailable"); return response.json() as Promise<Point[]>; })
      .then((data) => { if (!disposed) { points = data; resize(); } })
      .catch(() => { /* The loading label remains visible if the asset is unavailable. */ });
    return () => { disposed = true; abort.abort(); cancelAnimationFrame(frame); observer.disconnect(); motion.removeEventListener("change", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  return <div className="vehicle-photo-loading" role="status"><canvas ref={canvasRef} className="vehicle-photo-loading-canvas" aria-hidden="true"/><span className="vehicle-photo-loading-label">Creating your car image…</span></div>;
}
