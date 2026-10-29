import type { Vehicle } from "../lib/api";
import { Icon } from "./Icons";

export function VehiclePhoto({ vehicle }: { vehicle: Vehicle | null }) {
  if (vehicle?.generated_image_data_url) {
    return <><img className="vehicle-photo is-generated" src={vehicle.generated_image_data_url} alt={`Generated image of ${vehicle.exterior_color} ${vehicle.year} ${vehicle.make} ${vehicle.model}`}/><span className="vehicle-photo-label">Generated image</span></>;
  }
  const demoCivic = vehicle?.profile_source === "demo" && vehicle.year === 2021 &&
    vehicle.make?.toLowerCase() === "honda" && vehicle.model?.toLowerCase() === "civic" &&
    (!vehicle.exterior_color || /silver|gray|grey/i.test(vehicle.exterior_color));
  if (demoCivic) {
    return <><img className="vehicle-photo is-demo" src="/civic-2021-silver.png" alt="Representative image of a silver 2021 Honda Civic sedan"/><span className="vehicle-photo-label">{vehicle.image_status === "pending" ? "Creating image" : "Sample image"}</span></>;
  }
  return <div className="vehicle-photo-empty" aria-label={vehicle?.image_status === "pending" ? "Creating vehicle image" : "Vehicle image unavailable"}><Icon name="car" size={27}/><span>{vehicle?.image_status === "pending" ? "Creating your car image…" : vehicle?.image_status === "needs_color" ? "Add exterior color" : "Image unavailable"}</span></div>;
}
