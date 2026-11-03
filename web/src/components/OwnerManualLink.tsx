import { useEffect, useState } from "react";
import { api, type OwnerManualStatus, type Vehicle } from "../lib/api";
import { manufacturerSchedule } from "../lib/manufacturerSchedule";
import { Icon } from "./Icons";

export function OwnerManualLink({ vehicle }: { vehicle: Vehicle | null }) {
  const [status, setStatus] = useState<OwnerManualStatus | null>(null);
  const manual = manufacturerSchedule(vehicle);
  useEffect(() => {
    let active = true;
    setStatus(null);
    if (vehicle) void api.ownerManualStatus(vehicle.vehicle_id).then((value) => { if (active) setStatus(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [vehicle?.vehicle_id, vehicle?.year, vehicle?.make, vehicle?.model]);
  const href = status?.status === "ready" && vehicle ? api.ownerManualUrl(vehicle.vehicle_id) : manual?.sourceUrl;
  return href ? <a className="k-row owner-manual-link" href={href} target="_blank" rel="noopener noreferrer"><span className="k-row-art"><Icon name="book" size={21}/></span><span className="k-row-main"><strong>Owner manual</strong><small>{status?.status === "ready" ? "Saved for quick access" : `${vehicle?.year ?? ""} ${vehicle?.model ?? ""} · Reference`}</small></span><Icon name="chevron" size={16}/></a> : <div className="k-row"><span className="k-row-art"><Icon name="book" size={21}/></span><span className="k-row-main"><strong>Owner manual</strong><small>No verified manual for this vehicle yet</small></span></div>;
}
