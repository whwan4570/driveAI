import type { Vehicle } from "./api";
import type { ServiceComponent } from "./serviceIntervals";

export type ManualServiceItem = {
  code: string;
  summary: string;
  detail: string;
};

export type ManufacturerSchedule = {
  title: string;
  sourceUrl: string;
  items: Partial<Record<ServiceComponent, ManualServiceItem>>;
};

const CIVIC_2021_MANUAL = "https://techinfo.honda.com/rjanisis/pubs/OM/AH/ATBA2121OM/enu/ATBA2121OM.pdf#page=520";
const SONATA_2014_MANUAL = "https://dezosmanuals.com/wp-content/uploads/2021/07/2014-Hyundai-Sonata-OM.pdf";

/** Verified against the U.S. 2021 Civic Sedan owner's manual, Maintenance Minder table. */
export function manufacturerSchedule(vehicle: Vehicle | null): ManufacturerSchedule | null {
  if (vehicle?.year === 2014 && vehicle.make?.trim().toLowerCase() === "hyundai" &&
      /^sonata(?:\s|$)/.test(vehicle.model?.trim().toLowerCase() ?? "") &&
      !/hybrid/.test(`${vehicle.model ?? ""} ${vehicle.trim ?? ""}`.toLowerCase())) {
    return {
      title: "2014 Sonata (non-hybrid)", sourceUrl: SONATA_2014_MANUAL,
      items: {
        brake_pads: {
          code: "15,000 mi / 12 mo",
          summary: "Inspect brakes · 15,000 mi / 12 mo",
          detail: "The normal schedule lists front and rear brake disc/pad inspection at 15,000 miles or 12 months and subsequent scheduled intervals. Inspect more often under severe use. The manual does not set a fixed pad-replacement mileage; replace based on measured wear.",
        },
        brake_fluid: {
          code: "30,000 mi / 24 mo",
          summary: "Inspect brake fluid · 30,000 mi / 24 mo",
          detail: "The normal schedule calls for brake-fluid inspection at 30,000 miles or 24 months and subsequent scheduled intervals. This is an inspection, not an automatic fluid-replacement interval.",
        },
        cabin_filter: {
          code: "15,000 mi / 12 mo",
          summary: "Cabin filter · 15,000 mi / 12 mo",
          detail: "The normal schedule lists replacement of the climate-control air filter at 15,000 miles or 12 months and subsequent scheduled intervals. Dusty or heavily polluted use may require earlier replacement.",
        },
        engine_air_filter: {
          code: "7,500 mi / 6 mo",
          summary: "Inspect air filter · 7,500 mi / 6 mo",
          detail: "The normal schedule lists engine air-cleaner filter inspection at 7,500 miles or 6 months and replacement at 30,000 miles or 24 months. Severe use can require more frequent attention.",
        },
        engine_coolant: {
          code: "60,000 mi / 60 mo first",
          summary: "Coolant · first 60,000 mi / 60 mo",
          detail: "The normal schedule lists the first coolant replacement at 60,000 miles or 60 months, then every 30,000 miles or 24 months.",
        },
        drive_belt: {
          code: "60,000 mi / 72 mo first",
          summary: "Inspect belt · first 60,000 mi / 72 mo",
          detail: "The normal schedule lists the first drive-belt inspection at 60,000 miles or 72 months, then every 15,000 miles or 24 months.",
        },
      },
    };
  }
  if (!vehicle || vehicle.year !== 2021 || vehicle.make?.trim().toLowerCase() !== "honda") return null;
  const model = vehicle.model?.trim().toLowerCase() ?? "";
  const trim = vehicle.trim?.trim().toLowerCase() ?? "";
  if (!model.includes("civic") || /hatch|coupe|type r|\bsi\b/.test(`${model} ${trim}`) ||
    vehicle.body_style === "hatchback") return null;
  if (vehicle.body_style !== "sedan" && !model.includes("sedan") && vehicle.profile_source !== "demo") return null;
  return {
    title: "2021 Civic Sedan",
    sourceUrl: CIVIC_2021_MANUAL,
    items: {
      engine_oil: {
        code: "A / B",
        summary: "Oil service · Minder A or B",
        detail: "Change engine oil when Maintenance Minder A or B appears. B also includes the oil filter. If no Maintenance Minder message appears within 12 months of the last reset, change the oil every year.",
      },
      engine_oil_filter: {
        code: "B",
        summary: "Replace with oil · Minder B",
        detail: "Replace the engine oil and oil filter together when Maintenance Minder B appears. Minder A calls for engine oil only.",
      },
      tires: {
        code: "1",
        summary: "Rotate tires · Minder 1",
        detail: "Rotate the tires when Maintenance Minder sub-item 1 appears. Tire pressure, damage and tread condition still require direct checks.",
      },
      brake_pads: {
        code: "B",
        summary: "Inspect brakes · Minder B",
        detail: "Inspect the front and rear brakes when Maintenance Minder B appears. The manual does not give a fixed brake-pad replacement mileage; replacement depends on measured wear.",
      },
      brake_fluid: {
        code: "7",
        summary: "Replace fluid · Minder 7",
        detail: "Replace brake fluid when Maintenance Minder 7 appears. If it does not appear within 36 months after item 7 was reset, replace the brake fluid every 3 years.",
      },
      transmission_fluid: {
        code: "3",
        summary: "Replace fluid · Minder 3",
        detail: "Replace transmission fluid when Maintenance Minder 3 appears. For regular low-speed mountain driving, the manual specifies a 25,000-mile interval.",
      },
      cabin_filter: {
        code: "2",
        summary: "Cabin filter · Minder 2",
        detail: "Replace the dust and pollen filter when Maintenance Minder 2 appears. If you mainly drive in urban air with high soot concentrations, the manual specifies 15,000-mile replacement.",
      },
      engine_air_filter: {
        code: "2",
        summary: "Engine air filter · Minder 2",
        detail: "Replace the engine air cleaner element when Maintenance Minder 2 appears. For dusty driving, the manual specifies 15,000-mile replacement.",
      },
      spark_plugs: {
        code: "4",
        summary: "Replace plugs · Minder 4",
        detail: "Replace spark plugs when Maintenance Minder 4 appears. The same code calls for a valve-clearance inspection.",
      },
      engine_coolant: {
        code: "5",
        summary: "Replace coolant · Minder 5",
        detail: "Replace engine coolant when Maintenance Minder 5 appears. The manual does not provide a fixed mileage interval for this item.",
      },
      drive_belt: {
        code: "2",
        summary: "Inspect belt · Minder 2",
        detail: "Inspect the drive belt when Maintenance Minder 2 appears. Replace it based on inspection findings; the manual does not specify a fixed replacement mileage here.",
      },
    },
  };
}
