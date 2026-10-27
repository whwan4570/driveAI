export type DriveFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
};

export type DriveSummary = {
  todayMeters: number | null;
  typicalMeters: number | null;
  speedMps: number | null;
  trackedDays: number;
};

function localDay(timestamp: number): string {
  const day = new Date(timestamp);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function distanceMeters(a: DriveFix, b: DriveFix): number {
  const rad = Math.PI / 180;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Phone GPS estimates distance only while this web page has location tracking enabled.
export class DriveMetrics {
  private readonly key: string;
  private readonly days: Record<string, number>;
  private previous: DriveFix | null = null;
  private speedMps: number | null = null;
  private speedAt: number | null = null;

  constructor(vehicleId: string) {
    this.key = `carmori.driveMetrics.${vehicleId}`;
    let days: Record<string, number> = {};
    try {
      const stored = JSON.parse(localStorage.getItem(this.key) ?? "null") as { days?: Record<string, number> } | null;
      if (stored?.days && typeof stored.days === "object") {
        days = Object.fromEntries(Object.entries(stored.days).filter(([day, meters]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(meters) && meters >= 0));
      }
    } catch { /* Continue without saved driving data. */ }
    this.days = days;
  }

  observe(fix: DriveFix): DriveSummary {
    const previous = this.previous;
    this.previous = fix;
    if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude) || !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy > 60) {
      this.speedMps = null;
      this.speedAt = null;
      return this.summary(fix.timestamp);
    }

    const gpsSpeed = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed <= 55 ? fix.speed : null;
    this.speedMps = gpsSpeed;
    this.speedAt = gpsSpeed !== null ? fix.timestamp : null;
    if (!previous || previous.accuracy > 35 || fix.accuracy > 35 || localDay(previous.timestamp) !== localDay(fix.timestamp)) return this.summary(fix.timestamp);

    const seconds = (fix.timestamp - previous.timestamp) / 1000;
    if (seconds < 1 || seconds > 120) return this.summary(fix.timestamp);
    const meters = distanceMeters(previous, fix);
    const derivedSpeed = meters / seconds;
    if (derivedSpeed > 55) return this.summary(fix.timestamp);

    // A null GPS speed needs a larger displacement to avoid accumulating stationary GPS drift.
    const moving = gpsSpeed !== null
      ? gpsSpeed >= 2 && meters >= Math.max(8, (previous.accuracy + fix.accuracy) / 2)
      : previous.accuracy <= 20 && fix.accuracy <= 20 && seconds >= 3 && derivedSpeed >= 3 && meters >= Math.max(25, previous.accuracy + fix.accuracy);
    if (gpsSpeed === null && moving) { this.speedMps = derivedSpeed; this.speedAt = fix.timestamp; }
    if (moving) {
      const day = localDay(fix.timestamp);
      this.days[day] = (this.days[day] ?? 0) + meters;
      try { localStorage.setItem(this.key, JSON.stringify({ days: this.days })); } catch { /* Keep this session's estimate. */ }
    }
    return this.summary(fix.timestamp);
  }

  summary(now = Date.now()): DriveSummary {
    const today = localDay(now);
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDay = localDay(cutoff.getTime());
    const prior = Object.entries(this.days).filter(([day, meters]) => day >= cutoffDay && day < today && meters > 0).map(([, meters]) => meters);
    return {
      todayMeters: this.days[today] ?? null,
      typicalMeters: prior.length ? prior.reduce((sum, meters) => sum + meters, 0) / prior.length : null,
      speedMps: this.speedAt !== null && Math.abs(now - this.speedAt) <= 20_000 ? this.speedMps : null,
      trackedDays: prior.length,
    };
  }

  resetSegment(): void {
    this.previous = null;
    this.speedMps = null;
    this.speedAt = null;
  }
}
