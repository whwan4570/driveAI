// One briefing per enabled drive. GPS speed is a movement signal, not proof of ignition.

type Fix = { latitude: number; longitude: number; accuracy: number; speed: number | null; timestamp: number };

function distanceMeters(a: Fix, b: Fix): number {
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export class DrivingGate {
  private previous: Fix | null = null;
  private fastSamples = 0;
  private fired = false;

  observe(fix: Fix): boolean {
    if (this.fired) return false;
    const previous = this.previous;
    this.previous = fix;
    if (fix.accuracy > 60) { this.fastSamples = 0; return false; }

    let speed = fix.speed;
    if ((speed === null || !Number.isFinite(speed)) && previous && fix.accuracy <= 20 && previous.accuracy <= 20) {
      const seconds = (fix.timestamp - previous.timestamp) / 1000;
      if (seconds >= 3 && seconds <= 60) speed = distanceMeters(previous, fix) / seconds;
    }
    this.fastSamples = speed !== null && Number.isFinite(speed) && speed >= 7 ? this.fastSamples + 1 : 0;
    if (this.fastSamples < 2) return false;
    this.fired = true;
    return true;
  }

  reset() {
    this.previous = null;
    this.fastSamples = 0;
    this.fired = false;
  }

  markPlayed() { this.fired = true; }
}
