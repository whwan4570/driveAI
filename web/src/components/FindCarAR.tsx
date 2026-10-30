import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./Icons";
import { openRearCamera } from "../lib/camera";
import { bearingDegrees, cameraHeading, compassPoint, distanceMeters, formatDistance, relativeAngle, smoothHeading, type LatLon } from "../lib/arMath";

// Half the camera's horizontal field of view, roughly, for placing the pin across the screen.
const HALF_VIEW_DEG = 30;
const AHEAD_DEG = 25;

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/**
 * Camera view that points toward the saved parking spot with phone GPS and the compass.
 * It is a direction overlay, not world-anchored AR, so it is only as good as GPS (about 5–15 m outdoors).
 */
export function FindCarAR({ spot, compassAllowed, onClose }: {
  spot: LatLon & { note: string };
  compassAllowed: boolean;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const headingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<(LatLon & { accuracy: number }) | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    openRearCamera(videoRef.current)
      .then((opened) => { if (stopped) opened.getTracks().forEach((track) => track.stop()); else stream = opened; })
      .catch(() => { if (!stopped) setCameraError(true); });
    return () => { stopped = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) { setLocationError("Location is unavailable in this browser."); return; }
    const id = navigator.geolocation.watchPosition(
      (fix) => { setLocationError(null); setPosition({ lat: fix.coords.latitude, lon: fix.coords.longitude, accuracy: fix.coords.accuracy }); },
      (error) => setLocationError(error.code === error.PERMISSION_DENIED ? "Allow location to find your car." : "Waiting for a GPS signal…"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!compassAllowed) return;
    const onOrientation = (event: Event) => {
      const e = event as OrientationEvent;
      // iOS reports a tilt-compensated heading directly; elsewhere alpha is from north only on absolute events.
      const raw = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading
        : e.absolute && e.alpha !== null && e.beta !== null && e.gamma !== null ? cameraHeading(e.alpha, e.beta, e.gamma) : null;
      if (raw === null) return;
      headingRef.current = smoothHeading(headingRef.current, raw);
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => { frameRef.current = null; setHeading(headingRef.current); });
      }
    };
    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation);
      window.removeEventListener("deviceorientation", onOrientation);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [compassAllowed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const distance = position ? distanceMeters(position, spot) : null;
  const bearing = position ? bearingDegrees(position, spot) : null;
  const turn = bearing !== null && heading !== null ? relativeAngle(bearing, heading) : null;
  const arrived = distance !== null && position !== null && distance <= Math.max(12, position.accuracy);
  const ahead = turn !== null && Math.abs(turn) <= AHEAD_DEG;
  const pinStyle = turn === null || distance === null ? undefined
    : { "--ar-x": `${50 + (turn / HALF_VIEW_DEG) * 50}%`, "--ar-scale": Math.min(1.15, Math.max(0.55, 1.2 - distance / 250)) } as CSSProperties;

  const direction = arrived ? "You're here. Look around for your car."
    : distance === null || bearing === null ? locationError ?? "Finding your location…"
    : `${formatDistance(distance)} ${compassPoint(bearing)} · ${turn === null ? `head ${compassPoint(bearing)}` : ahead ? "straight ahead" : turn > 0 ? "turn right" : "turn left"}`;

  return <div className="ar-screen" role="dialog" aria-modal="true" aria-label="Find my car">
    <video ref={videoRef} className="ar-video" playsInline muted aria-hidden="true"/>
    {cameraError && <p className="ar-camera-error">Camera unavailable. Directions still update below.</p>}
    <button className="ar-close" type="button" onClick={onClose} aria-label="Close AR view"><Icon name="close" size={22}/></button>
    {turn !== null && !arrived && <div className={`ar-chevrons${ahead ? " is-ahead" : ""}`} style={{ "--ar-turn": `${Math.max(-110, Math.min(110, turn))}deg` } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 120 80"><path d="M20 60 60 22l40 38"/><path d="M20 78 60 40l40 38"/></svg>
    </div>}
    {(ahead || arrived) && pinStyle && <div className="ar-pin" style={pinStyle} aria-hidden="true">
      <svg viewBox="0 0 64 84"><defs><radialGradient id="ar-pin-fill" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#ff6b5e"/><stop offset="1" stopColor="#d4130c"/></radialGradient></defs><path d="M32 82C32 82 4 50 4 30a28 28 0 1 1 56 0c0 20-28 52-28 52Z" fill="url(#ar-pin-fill)"/><circle cx="32" cy="30" r="10" fill="#fff" fillOpacity=".9"/></svg>
    </div>}
    {compassAllowed ? heading === null && position && <p className="ar-hint">Move your phone in a figure 8 to wake the compass.</p>
      : <p className="ar-hint">Compass is off in Settings. Head {bearing === null ? "toward your car" : compassPoint(bearing)}.</p>}
    <div className="ar-panel">
      <div className="ar-card" aria-live="polite">
        <strong>{spot.note || "Your car"}</strong>
        <span>{direction}</span>
        {position && <small>GPS accuracy ±{formatDistance(position.accuracy)} · best in open lots</small>}
      </div>
      <button className="ar-end" type="button" onClick={onClose}>End AR</button>
    </div>
  </div>;
}
