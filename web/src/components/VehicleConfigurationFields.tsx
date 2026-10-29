import { useState } from "react";

export type BodyStyle = "sedan" | "hatchback";

export function isCivic(make: string, model: string): boolean {
  return make.trim().toLowerCase() === "honda" && model.trim().toLowerCase().includes("civic");
}

export function inferredCivicBodyStyle(model: string, trim = ""): BodyStyle | "" {
  const name = `${model} ${trim}`.toLowerCase();
  return /hatch|type r/.test(name) ? "hatchback" : /sedan/.test(name) ? "sedan" : "";
}

const SEDAN_TRIMS = ["LX", "Sport", "EX", "EX-L", "Touring"];
const HATCHBACK_TRIMS = ["LX", "Sport", "EX", "Sport Touring", "Type R"];

export function VehicleConfigurationFields({ make, model, bodyStyle, onBodyStyleChange, trim, onTrimChange }: {
  make: string;
  model: string;
  bodyStyle: BodyStyle | "";
  onBodyStyleChange: (value: BodyStyle | "") => void;
  trim: string;
  onTrimChange: (value: string) => void;
}) {
  const [customTrim, setCustomTrim] = useState(false);
  if (!isCivic(make, model)) return <label>Trim <span className="optional">optional</span><input value={trim} onChange={(event) => onTrimChange(event.target.value)} maxLength={60} placeholder="e.g. EX"/></label>;
  const choices = bodyStyle === "sedan" ? SEDAN_TRIMS : HATCHBACK_TRIMS;
  const other = customTrim || Boolean(trim && !choices.includes(trim));
  return <>
    <label>Body style<select value={bodyStyle} onChange={(event) => { onBodyStyleChange(event.target.value as BodyStyle | ""); onTrimChange(""); setCustomTrim(false); }} required>
      <option value="">Select body style</option><option value="sedan">Sedan</option><option value="hatchback">Hatchback</option>
    </select></label>
    <label>Trim <span className="optional">optional</span><select value={other ? "other" : trim} onChange={(event) => { if (event.target.value === "other") { setCustomTrim(true); onTrimChange(""); } else { setCustomTrim(false); onTrimChange(event.target.value); } }}>
      <option value="">Not specified</option>{choices.map((choice) => <option value={choice} key={choice}>{choice}</option>)}<option value="other">Other</option>
    </select></label>
    {other && <label>Other trim<input value={trim} onChange={(event) => onTrimChange(event.target.value)} maxLength={60} placeholder="Enter trim"/></label>}
  </>;
}
