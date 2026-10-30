import type { CSSProperties } from "react";
import type { Step, WaitReason } from "../lib/api";

/**
 * Step cue drawn over the live camera at the washer inlet. The phone stays on a mount, so the
 * point the user tapped (or the box found in the photo) keeps marking the inlet in the live view.
 * This is a 2D overlay at a fixed spot, not tracked 3D AR.
 */
export function InletCue({ left, top, step, waiting, paused }: {
  left: number | string;
  top: number | string;
  step: Step | null;
  waiting: WaitReason | null | undefined;
  paused: boolean;
}) {
  if (step === "RECORDED" || step === "CONFIRM_PRODUCT") return null;
  const style = { left, top } as CSSProperties;
  const cue = waiting === "OCCLUDED" || waiting === "WRONG_PART" ? "blocked"
    : step === "OPEN_CAP" ? "open"
    : step === "POUR" ? "pour"
    : step === "FINISH" ? "close"
    : "pin";
  const label = cue === "blocked" ? "Clear the view" : cue === "open" ? "Open" : cue === "pour" ? "Pour here" : cue === "close" ? "Close" : step ? "This cap" : "Washer inlet";

  return <div className={`inlet-cue is-${cue}${paused ? " is-paused" : ""}`} style={style} aria-hidden="true">
    {cue === "pin" && <svg className="inlet-cue-pin" viewBox="0 0 64 84"><defs><radialGradient id="inlet-pin-fill" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#ff6b5e"/><stop offset="1" stopColor="#d4130c"/></radialGradient></defs><path d="M32 82C32 82 4 50 4 30a28 28 0 1 1 56 0c0 20-28 52-28 52Z" fill="url(#inlet-pin-fill)"/><circle cx="32" cy="30" r="10" fill="#fff" fillOpacity=".9"/></svg>}
    {(cue === "open" || cue === "close") && <svg className="inlet-cue-turn" viewBox="0 0 120 120">
      {/* Counter-clockwise to open, clockwise to close. */}
      <g transform={cue === "open" ? "translate(120 0) scale(-1 1)" : undefined}><path d="M60 14a46 46 0 1 1-40.4 24"/><path d="M8 26l11.6 13.8L35 31"/></g>
    </svg>}
    {cue === "pour" && <svg className="inlet-cue-pour" viewBox="0 0 80 120"><path d="M14 18l26 24 26-24"/><path d="M14 50l26 24 26-24"/><path d="M14 82l26 24 26-24"/></svg>}
    {cue === "blocked" && <span className="inlet-cue-ring"/>}
    <span className="inlet-cue-label">{label}</span>
  </div>;
}
