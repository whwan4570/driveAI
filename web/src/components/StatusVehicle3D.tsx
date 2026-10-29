import { createElement, useEffect, useMemo, useRef, useState } from "react";
import "@google/model-viewer";
import type { ModelViewerElement } from "@google/model-viewer";
import type { CareRecommendation, CareResponse, Vehicle } from "../lib/api";

type Severity = "clear" | "caution" | "warning" | "unknown";
type Concern = { component: CareRecommendation["component"]; severity: "caution" | "warning"; item: CareRecommendation };

function bundledModelFor(vehicle: Vehicle | null): string | null {
  if (!vehicle) return null;
  const make = vehicle.make?.trim().toLowerCase();
  const model = vehicle.model?.trim().toLowerCase() || "";
  const variant = `${model} ${vehicle.trim || ""}`.toLowerCase();
  if (vehicle.year === 2014 && make === "hyundai" && /^sonata(?:\s|$)/.test(model) && !/hybrid/.test(variant)) {
    return "/models/sonata.glb";
  }
  if (vehicle.year === 2021 && make === "honda" && /^civic(?:\s|$)/.test(model) &&
      vehicle.body_style !== "hatchback" && !/hatch|type r|coupe|\bsi\b/.test(variant)) {
    return "/models/civic.glb";
  }
  return null;
}

function paintColor(name: string | null | undefined): string {
  const color = (name || "").toLowerCase();
  if (/silver|gray|grey|platinum|lunar|steel/.test(color)) return "#aeb8c1";
  if (/white|pearl|ivory/.test(color)) return "#e8e9e5";
  if (/black|onyx|obsidian/.test(color)) return "#252a32";
  if (/red|crimson|scarlet|ruby/.test(color)) return "#ad3438";
  if (/blue|navy|azure/.test(color)) return "#315e87";
  if (/green|emerald/.test(color)) return "#347161";
  if (/yellow|gold|champagne/.test(color)) return "#c4a348";
  if (/orange|copper/.test(color)) return "#ba683a";
  if (/brown|bronze/.test(color)) return "#79604e";
  return "#aeb8c1";
}

function concernSeverity(priority: CareRecommendation["priority"]): Concern["severity"] | null {
  if (priority === "WARNING") return "warning";
  if (priority === "CHECK_SOON" || priority === "INFORMATION_NEEDED") return "caution";
  return null;
}

export function StatusVehicle3D({ vehicle, care, loading, samplePreview = false }: {
  vehicle: Vehicle | null;
  care: CareResponse | null;
  loading: boolean;
  samplePreview?: boolean;
}) {
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const [selected, setSelected] = useState<Concern | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [bundledFailed, setBundledFailed] = useState(false);
  const customModel = vehicle?.model_3d_status === "ready" && !!vehicle.model_3d_url && !modelFailed;
  const bundledSrc = bundledModelFor(vehicle);
  const bundledModel = !customModel && !!bundledSrc && !bundledFailed;
  const detailedModel = customModel || bundledModel;
  const modelSrc = customModel
    ? `/api${vehicle.model_3d_url}?v=${encodeURIComponent(vehicle.model_3d_updated_at || "ready")}`
    : bundledModel ? bundledSrc : "/models/modern-sedan.glb";
  const concerns = useMemo<Concern[]>(() => (care?.recommendations ?? []).flatMap((item) => {
    const severity = concernSeverity(item.priority);
    return severity ? [{ component: item.component, severity, item }] : [];
  }), [care]);
  const severity: Severity = loading || !care ? "unknown" : concerns.some((item) => item.severity === "warning")
    ? "warning" : concerns.length ? "caution" : "clear";

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setModelReady(false);
    const updatePaint = () => {
      if (!detailedModel) {
        const body = viewer.model?.materials.find((material) => material.name === "paint");
        body?.pbrMetallicRoughness.setBaseColorFactor(paintColor(vehicle?.exterior_color));
      }
      setModelReady(true);
    };
    const onError = () => {
      setModelReady(false);
      if (customModel) setModelFailed(true);
      else if (bundledModel) setBundledFailed(true);
    };
    viewer.addEventListener("load", updatePaint);
    viewer.addEventListener("error", onError);
    if (viewer.model && viewer.getAttribute("src") === modelSrc) updatePaint();
    return () => { viewer.removeEventListener("load", updatePaint); viewer.removeEventListener("error", onError); };
  }, [vehicle?.exterior_color, customModel, bundledModel, detailedModel, modelSrc]);

  useEffect(() => { setModelFailed(false); setBundledFailed(false); }, [vehicle?.vehicle_id, vehicle?.model_3d_updated_at, vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim, vehicle?.body_style]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const stage = viewer?.parentElement;
    if (!viewer || !stage) return;
    const syncViewerSize = () => {
      if (stage.clientWidth > 0) viewer.style.width = `${stage.clientWidth}px`;
      if (stage.clientHeight > 0) viewer.style.height = `${stage.clientHeight}px`;
      const input = viewer.shadowRoot?.querySelector<HTMLElement>(".userInput");
      if (input) input.style.outline = "none";
    };
    const observer = new ResizeObserver(syncViewerSize);
    observer.observe(stage);
    syncViewerSize();
    return () => observer.disconnect();
  }, [modelSrc]);

  const viewDetails = (component: Concern["component"]) => {
    setSelected(null);
    document.getElementById(`status-detail-${component}`)?.click();
  };

  const hotspots = concerns.map((concern) => createElement("button", {
    key: concern.component,
    type: "button",
    slot: `hotspot-${concern.component}`,
    "data-position": bundledModel
      ? concern.component === "tires" ? "0.235m -0.105m 0.30m" : "0.10m 0.08m 0.34m"
      : concern.component === "tires" ? "0.88m 0.36m 1.55m" : "0.4m 1.02m 1.65m",
    "data-normal": concern.component === "tires" ? "1m 0m 0m" : "0m 1m 0m",
    className: `vehicle-hotspot ${concern.severity}`,
    "aria-label": `${concern.item.title}. Show summary`,
    onClick: () => setSelected(concern),
  }, createElement("span", { className: "vehicle-hotspot-core" })));

  return <section className="status-3d-card" aria-label="Interactive vehicle status">
    <div className="status-3d-header">
      <div><h2>{vehicle?.nickname || [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "My vehicle"}</h2><p>{vehicle?.odometer_km === null || !vehicle ? "Odometer not set" : `${Math.round(vehicle.odometer_km / 1.609344).toLocaleString()} mi`}</p></div>
      <span className={`status-health-light ${severity}`} role="status"><span className="status-health-led"/>{severity === "clear" ? "No flagged items" : severity === "unknown" ? "Checking" : severity === "warning" && concerns.every((concern) => concern.severity === "warning") ? `${concerns.length} warning${concerns.length === 1 ? "" : "s"}` : `${concerns.length} to review`}</span>
    </div>
    <div className="status-model-stage">
      {createElement("model-viewer", {
        key: `status-3d-framing-v6:${modelSrc}`,
        ref: viewerRef,
        className: "status-model-viewer",
        src: modelSrc,
        alt: detailedModel ? `Rotatable 3D model of ${vehicle?.year} ${vehicle?.make} ${vehicle?.model}` : `Rotatable 3D illustration in ${vehicle?.exterior_color || "silver"}`,
        "camera-controls": "",
        "disable-pan": "",
        "camera-orbit": detailedModel ? "25deg 70deg auto" : "20deg 75deg 6.8m",
        "camera-target": detailedModel ? "auto auto auto" : "-0.3m 0.4m 0.35m",
        "field-of-view": "32deg",
        "interaction-prompt": "none",
        "shadow-intensity": "1",
        exposure: "1.15",
        "touch-action": "pan-y",
      }, ...(customModel ? [] : hotspots))}
      {customModel && concerns.length > 0 && !selected && <div className="status-model-issues" aria-label="Areas to review">{concerns.map((concern) => <button key={concern.component} type="button" className={concern.severity} onClick={() => setSelected(concern)}>{concern.item.title}</button>)}</div>}
      {!modelReady && <span className="status-model-loading">Loading 3D view…</span>}
      {selected && <div className={`status-concern-popover ${selected.severity}`} role="region" aria-label={`${selected.item.title} summary`}>
        <button className="status-concern-close" type="button" onClick={() => setSelected(null)} aria-label="Close summary">×</button>
        <span className="status-concern-level">{selected.severity === "warning" ? "WARNING" : "CHECK SOON"}</span>
        <strong>{selected.item.title}</strong>
        <p>{selected.item.explanation}</p>
        <button className="status-concern-more" type="button" onClick={() => viewDetails(selected.component)}>View details <span aria-hidden="true">↓</span></button>
      </div>}
    </div>
    <p className="status-3d-disclaimer">{customModel ? "Generated 3D model" : bundledModel ? "Vehicle 3D model" : "Illustrative 3D model"} · {samplePreview ? "Sample alerts, not vehicle diagnostics." : "Status is based on saved records, not live diagnostics."}</p>
  </section>;
}
