import type { Vehicle } from "../lib/api";
import { Icon } from "./Icons";

export function VehiclePhoto({ vehicle }: { vehicle: Vehicle | null }) {
  if (vehicle?.generated_image_data_url) {
    return <><img className="vehicle-photo is-generated" src={vehicle.generated_image_data_url} alt={`Generated image of ${vehicle.exterior_color} ${vehicle.year} ${vehicle.make} ${vehicle.model}`}/><span className="vehicle-photo-label">Generated image</span></>;
  }
  // Photo of a 2013 Sonata GLS, the same YF generation as the 2014 demo car (credits in web/public/CREDITS.md).
  if (vehicle?.spec_id === "hyundai_sonata_2014") {
    return <><img className="vehicle-photo is-sample-photo" src="/sonata-2014-sample.jpg" alt="Representative photo of a Hyundai Sonata GLS of the same generation"/><span className="vehicle-photo-label">{vehicle.image_status === "pending" ? "Creating image" : "Sample image"}</span></>;
  }
  return <div className="vehicle-photo-empty" aria-label={vehicle?.image_status === "pending" ? "Creating vehicle image" : "Vehicle image unavailable"}><Icon name="car" size={27}/><span>{vehicle?.image_status === "pending" ? "Creating your car image…" : vehicle?.image_status === "needs_color" ? "Add exterior color" : "Image unavailable"}</span></div>;
}
