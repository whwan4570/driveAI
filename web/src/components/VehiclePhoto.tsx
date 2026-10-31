import type { Vehicle } from "../lib/api";
import { Icon } from "./Icons";
import { VehicleLoading } from "./VehicleLoading";

export function VehiclePhoto({ vehicle }: { vehicle: Vehicle | null }) {
  if (vehicle?.image_status === "pending") {
    return <VehicleLoading/>;
  }
  if (vehicle?.generated_image_data_url) {
    return <img className="vehicle-photo is-generated" src={vehicle.generated_image_data_url} alt={`${vehicle.exterior_color} ${vehicle.year} ${vehicle.make} ${vehicle.model}`}/>;
  }
  // Photo of a 2013 Sonata GLS, the same YF generation as the 2014 demo car (credits in web/public/CREDITS.md).
  if (vehicle?.spec_id === "hyundai_sonata_2014") {
    return <><img className="vehicle-photo is-sample-photo" src="/sonata-2014-sample.jpg" alt="Representative photo of a Hyundai Sonata GLS of the same generation"/><span className="vehicle-photo-label">Sample image</span></>;
  }
  return <div className="vehicle-photo-empty" aria-label="Vehicle image unavailable"><Icon name="car" size={27}/><span>{vehicle?.image_status === "needs_color" ? "Add exterior color" : "Image unavailable"}</span></div>;
}
