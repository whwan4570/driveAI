import { createElement, useEffect, useMemo, useRef, useState } from "react";
import "@google/model-viewer";
import type { ModelViewerElement } from "@google/model-viewer";
import type { CareResponse, MaintenanceRecord, Vehicle } from "../lib/api";
import { intervalRemaining, latestService, loadServiceIntervals, serviceTone, SERVICE_COMPONENTS, type ServiceComponent } from "../lib/serviceIntervals";
import { SAMPLE_SERVICE_REMAINING } from "../lib/statusPreview";
import { ZoomableInterior } from "./ZoomableInterior";

type Severity = "clear" | "caution" | "warning" | "unknown";
type StatusComponent = ServiceComponent | "washer_fluid";
type Concern = { component: StatusComponent; severity: "caution" | "warning"; title: string; explanation: string };
type ModelBounds = { center: { x: number; y: number; z: number }; dimensions: { x: number; y: number; z: number } };

// These are approximate service areas on the illustration, not part diagnostics.
const MARKER_OFFSETS: Record<StatusComponent, [number, number, number]> = {
  washer_fluid: [-0.14, 0.07, 0.28], engine_oil: [0.02, 0.08, 0.28], engine_oil_filter: [0.13, 0.08, 0.20],
  tires: [0.23, -0.10, 0.30], brake_pads: [0.23, -0.10, 0.12], brake_fluid: [-0.11, 0.08, 0.08],
  transmission_fluid: [0.10, 0.08, 0.05], cabin_filter: [-0.08, 0.10, -0.08], engine_air_filter: [-0.09, 0.08, 0.18],
  spark_plugs: [0.01, 0.08, 0.12], engine_coolant: [0.14, 0.08, 0.32], drive_belt: [0.17, 0.08, 0.12],
};

function markerPosition(component: StatusComponent, bundledSrc: string | null, customBounds: ModelBounds | null): string {
  const [x, y, z] = MARKER_OFFSETS[component];
  if (customBounds) {
    const { center, dimensions } = customBounds;
    const wheelArea = component === "tires" || component === "brake_pads";
    return `${center.x + (wheelArea ? 0.48 : x) * dimensions.x}m ${center.y + (wheelArea ? -0.27 : 0.19) * dimensions.y}m ${center.z + z * dimensions.z}m`;
  }
  if (bundledSrc) return `${x}m ${y}m ${z}m`;
  if (component === "tires" || component === "brake_pads") return `0.88m 0.36m ${component === "tires" ? "1.55" : "0.95"}m`;
  return `${0.4 + x * 1.6}m 1.02m ${1.65 + (z - 0.28) * 1.5}m`;
}

function bundledModelFor(vehicle: Vehicle | null): string | null {
  if (!vehicle) return null;
  const make = vehicle.make?.trim().toLowerCase();
  const model = vehicle.model?.trim().toLowerCase() || "";
  const variant = `${model} ${vehicle.trim || ""}`.toLowerCase();
  if (vehicle.year === 2014 && make === "hyundai" && /^sonata(?:\s|$)/.test(model) && !/hybrid/.test(variant)) {
    return "/models/demo.glb";
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

export function StatusVehicle3D({ vehicle, records, care, loading, samplePreview = false, showHeader = true }: {
  vehicle: Vehicle | null;
  records: MaintenanceRecord[];
  care: CareResponse | null;
  loading: boolean;
  samplePreview?: boolean;
  /** The Status page already shows the car name and review count above this card. */
  showHeader?: boolean;
}) {
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const [selected, setSelected] = useState<Concern | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [bundledFailed, setBundledFailed] = useState(false);
  const [customBounds, setCustomBounds] = useState<ModelBounds | null>(null);
  const [viewMode, setViewMode] = useState<"ex" | "in">("ex");
  const customModel = vehicle?.model_3d_status === "ready" && !!vehicle.model_3d_url && !modelFailed;
  const bundledSrc = bundledModelFor(vehicle);
  const interiorAvailable = bundledSrc === "/models/demo.glb";
  const bundledModel = !customModel && !!bundledSrc && !bundledFailed;
  const detailedModel = customModel || bundledModel;
  const modelSrc = customModel
    ? `/api${vehicle.model_3d_url}?v=${encodeURIComponent(vehicle.model_3d_updated_at || "ready")}`
    : bundledModel ? bundledSrc : "/models/modern-sedan.glb";
  const concerns = useMemo<Concern[]>(() => {
    if (!vehicle) return [];
    const intervals = vehicle ? loadServiceIntervals(vehicle.vehicle_id) : {};
    return [...SERVICE_COMPONENTS, { id: "washer_fluid" as const, label: "Washer fluid", short: "Fluid" }].flatMap(({ id, label }) => {
      const recommendation = care?.recommendations.find((item) => item.component === id);
      const percent = id === "washer_fluid" ? null : samplePreview ? SAMPLE_SERVICE_REMAINING[id]
        : intervalRemaining(latestService(records, id), intervals[id], vehicle?.odometer_km ?? null);
      const tone = serviceTone(percent, recommendation?.priority);
      if (tone !== "due" && tone !== "soon") return [];
      return [{ component: id, severity: tone === "due" ? "warning" as const : "caution" as const,
        title: label, explanation: samplePreview ? (percent === null ? "Sample alert. Check the level directly." : `Sample interval: ${percent}% remaining. This is not a finding about your car.`)
          : recommendation?.explanation ?? `${percent}% of your saved service interval remains. This is a schedule estimate, not a measured condition.` }];
    });
  }, [vehicle, records, care, samplePreview]);
  const severity: Severity = loading || !vehicle ? "unknown" : concerns.some((item) => item.severity === "warning")
    ? "warning" : concerns.length ? "caution" : "clear";
  const displayedConcerns = loading || (customModel && !customBounds) ? [] : concerns;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setModelReady(false);
    const updatePaint = () => {
      if (customModel) setCustomBounds({ center: viewer.getBoundingBoxCenter(), dimensions: viewer.getDimensions() });
      else setCustomBounds(null);
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

  useEffect(() => { setModelFailed(false); setBundledFailed(false); setCustomBounds(null); setViewMode("ex"); }, [vehicle?.vehicle_id, vehicle?.model_3d_updated_at, vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim, vehicle?.body_style]);

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

  const hotspots = displayedConcerns.map((concern) => createElement("button", {
    key: concern.component,
    type: "button",
    slot: `hotspot-${concern.component}`,
    "data-position": markerPosition(concern.component, bundledModel ? bundledSrc : null, customModel ? customBounds : null),
    "data-normal": concern.component === "tires" || concern.component === "brake_pads" ? "1m 0m 0m" : "0m 1m 0m",
    className: `vehicle-hotspot ${concern.severity}`,
    "aria-label": `${concern.title}. Show summary`,
    onClick: () => setSelected(concern),
  }, createElement("span", { className: "vehicle-hotspot-core" })));

  return <section className="status-3d-card" aria-label="Interactive vehicle status">
    {showHeader && <div className="status-3d-header">
      <div><h2>{vehicle?.nickname || [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "My vehicle"}</h2><p>{vehicle?.odometer_km === null || !vehicle ? "Odometer not set" : `${Math.round(vehicle.odometer_km / 1.609344).toLocaleString()} mi`}</p></div>
      <span className={`status-health-light ${severity}`} role="status"><span className="status-health-led"/>{severity === "clear" ? "No flagged items" : severity === "unknown" ? "Checking" : severity === "warning" && concerns.every((concern) => concern.severity === "warning") ? `${concerns.length} warning${concerns.length === 1 ? "" : "s"}` : `${concerns.length} to review`}</span>
    </div>}
    <div className="status-model-stage">
      {!showHeader && <span className={`status-health-light status-health-on-model ${severity}`} role="status"><span className="status-health-led"/>{severity === "clear" ? "No flagged items" : severity === "unknown" ? "Checking" : severity === "warning" ? `${concerns.length} to review` : `${concerns.length} to review`}</span>}
      {interiorAvailable && <div className="status-view-toggle" role="group" aria-label="Vehicle view">
        <button type="button" aria-label="Exterior view" aria-pressed={viewMode === "ex"} onClick={() => { setViewMode("ex"); setSelected(null); }}>Ex</button>
        <button type="button" aria-label="Interior view" aria-pressed={viewMode === "in"} onClick={() => { setViewMode("in"); setSelected(null); }}>In</button>
      </div>}
      {createElement("model-viewer", {
        key: `status-3d-framing-v6:${modelSrc}`,
        ref: viewerRef,
        className: `status-model-viewer${viewMode === "in" ? " is-hidden" : ""}`,
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
      }, ...hotspots)}
      {viewMode === "in" && interiorAvailable && <ZoomableInterior src="/images/sonata-interior-illustration.png" alt="Illustrative view of the demo car cabin, looking forward from the rear seat"/>}
      {viewMode === "ex" && !modelReady && <span className="status-model-loading">Loading 3D view…</span>}
      {selected && <div className={`status-concern-popover ${selected.severity}`} role="region" aria-label={`${selected.title} summary`}>
        <button className="status-concern-close" type="button" onClick={() => setSelected(null)} aria-label="Close summary">×</button>
        <span className="status-concern-level">{selected.severity === "warning" ? "WARNING" : "CHECK SOON"}</span>
        <strong>{selected.title}</strong>
        <p>{selected.explanation}</p>
        <button className="status-concern-more" type="button" onClick={() => viewDetails(selected.component)}>View details <span aria-hidden="true">↓</span></button>
      </div>}
    </div>
  </section>;
}
