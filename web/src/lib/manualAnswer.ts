import type { MaintenanceRecord, Vehicle } from "./api";

type Answer = { text: string; fact_ids: string[]; source_url?: string | null; source_label?: string | null };

const CIVIC_SEDAN_MANUAL = "https://techinfo.honda.com/rjanisis/pubs/OM/AH/ATBA2121OM/enu/ATBA2121OM.pdf#page=520";
const SONATA_2014_MANUAL = "https://dezosmanuals.com/wp-content/uploads/2021/07/2014-Hyundai-Sonata-OM.pdf";

/** Keep the live prototype useful until its Python server is restarted with the manual source. */
export function completeBrakeAnswer(answer: Answer, question: string, vehicle: Vehicle | null, records: MaintenanceRecord[]): Answer {
  if (!vehicle || !/\bbr(?:ake|eak)\b/i.test(question) || !/\bpads?\b/i.test(question) || /\bfluid\b/i.test(question)) return answer;
  const name = `${vehicle.model ?? ""} ${vehicle.trim ?? ""}`.toLowerCase();
  if (vehicle.year === 2014 && vehicle.make?.toLowerCase() === "hyundai" && /^sonata(?:\s|$)/.test(vehicle.model?.toLowerCase() ?? "") && !name.includes("hybrid")) {
    if (!/unknown|unavailable|cannot answer|don't know/i.test(answer.text)) return answer;
    const last = records.filter((record) => record.component === "brake_pads" && record.user_confirmed)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0];
    const history = last ? `The last saved brake-pad ${last.event_type} was ${new Date(last.completed_at).toLocaleDateString("en-US", { dateStyle: "medium" })}.` : "No recent brake-pad inspection is saved, so arrange an inspection now.";
    return {
      text: `For a non-hybrid 2014 Sonata, Hyundai's normal schedule calls for front and rear brake-pad inspection at 15,000 miles or 12 months and at subsequent scheduled intervals; severe use calls for more frequent checks. ${history} Mileage alone cannot show remaining pad thickness. The manual gives no fixed replacement mileage: replace pads based on measured wear. A persistent high-pitched brake-wear sound needs prompt service.`,
      fact_ids: ["owner_manual"], source_url: SONATA_2014_MANUAL,
      source_label: "Hyundai 2014 Sonata Owner’s Manual · Maintenance (archived PDF)",
    };
  }
  if (vehicle.year !== 2021 || vehicle.make?.toLowerCase() !== "honda" || !name.includes("civic") || /hatch|coupe|type r|\bsi\b/.test(name) || vehicle.body_style === "hatchback") return answer;
  const sedanConfirmed = vehicle.body_style === "sedan" || name.includes("sedan") || vehicle.profile_source === "demo";
  if (sedanConfirmed && answer.text.includes("This is the 2021 Civic Sedan manual; confirm your body style.")) {
    return { ...answer, text: answer.text.replace("This is the 2021 Civic Sedan manual; confirm your body style.", "").trim() };
  }
  if (!/unknown|unavailable|cannot answer|don't know/i.test(answer.text)) return answer;

  const last = records.filter((record) => record.component === "brake_pads")
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0];
  const driving = [
    vehicle.odometer_km !== null ? `${Math.round(vehicle.odometer_km / 1.609344).toLocaleString("en-US")} mi` : null,
    vehicle.weekly_miles !== null ? `${Math.round(vehicle.weekly_miles)} mi/week` : null,
    vehicle.highway_percent !== null ? `${vehicle.highway_percent}% highway` : null,
  ].filter(Boolean).join(", ");
  const history = last
    ? `Your last saved brake ${last.event_type} was ${new Date(last.completed_at).toLocaleDateString("en-US", { dateStyle: "medium" })}.`
    : "I don't have a brake inspection recorded, so have the pads checked now.";
  return {
    text: `${driving ? `At ${driving}, ` : ""}your driving pattern cannot tell us the remaining pad thickness. ${history} Honda's Maintenance Minder B calls for front and rear brake inspection. Replace pads based on measured wear, not an assumed mileage. If braking makes a screeching sound, have the car inspected promptly.${sedanConfirmed ? "" : " This is the 2021 Civic Sedan manual; confirm your body style."}`,
    fact_ids: ["owner_manual"],
    source_url: CIVIC_SEDAN_MANUAL,
    source_label: "Honda 2021 Civic Sedan Owner’s Manual · Maintenance Minder B",
  };
}
