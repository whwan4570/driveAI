import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "../components/Icons";
import { HistorySummary } from "../components/HistorySummary";
import { HistoryCalendar } from "../components/HistoryCalendar";
import { VehiclePhoto } from "../components/VehiclePhoto";
import { ServiceStatus } from "../components/ServiceStatus";
import { api, type CareResponse, type MaintenanceRecord, type MajorIssue, type Vehicle } from "../lib/api";
import { parseUtterance } from "../lib/commands";
import { DrivingGate } from "../lib/drivingGate";
import { DriveMetrics, type DriveFix, type DriveSummary } from "../lib/driveMetrics";
import { documentReminder, listDocuments, DOCUMENT_KINDS, type SavedDocument } from "../lib/documentVault";
import { MAINTENANCE_LABELS } from "../lib/serviceIntervals";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";
import { Documents } from "./Documents";
import { RecordForm } from "./RecordForm";
import { TireInspection } from "./TireInspection";
import { VehicleEditor } from "./VehicleEditor";

type Tab = "home" | "status" | "assistant" | "guide" | "history" | "documents";
const StatusVehicle3D = lazy(() => import("../components/StatusVehicle3D").then((module) => ({ default: module.StatusVehicle3D })));
const SOURCE_LABEL: Record<MaintenanceRecord["completion_source"], string> = {
  observed_sequence: "Observed by camera",
  user_voice_confirmed: "Confirmed by voice",
  manual_entry: "Added manually",
};

function miles(meters: number | null): string {
  if (meters === null) return "—";
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function mph(metersPerSecond: number | null): string {
  if (metersPerSecond === null) return "—";
  return `${Math.round(metersPerSecond * 2.236936)} mph`;
}

function vehicleName(vehicle: Vehicle | null): string {
  if (!vehicle) return "Loading vehicle";
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
}

function priorityLabel(priority: string): string {
  return ({ WARNING: "Warning", CHECK_SOON: "Check soon", INFORMATION_NEEDED: "Needs info", ROUTINE: "Routine" } as Record<string, string>)[priority] ?? priority;
}

export function Home({ vehicleId, started, onStart, onStartTask }: {
  vehicleId: string;
  started: boolean;
  onStart: () => Promise<void>;
  onStartTask: () => Promise<void>;
}) {
  const voice = useVoice();
  const [tab, setTab] = useState<Tab>("home");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [majorIssues, setMajorIssues] = useState<MajorIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesAvailable, setIssuesAvailable] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [care, setCare] = useState<CareResponse | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [careLoading, setCareLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [tireOpen, setTireOpen] = useState(false);
  const [recordComponent, setRecordComponent] = useState<"washer_fluid" | "tires">("washer_fluid");
  const [historyView, setHistoryView] = useState<"list" | "calendar">("list");
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefingState, setBriefingState] = useState<"idle" | "loading" | "speaking" | "played">("idle");
  const [fabHidden, setFabHidden] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoMessage, setAutoMessage] = useState("Enable once before your drive");
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("Tracking is off");
  const metricsRef = useRef<DriveMetrics | null>(null);
  if (metricsRef.current === null) metricsRef.current = new DriveMetrics(vehicleId);
  const [driveSummary, setDriveSummary] = useState<DriveSummary>(() => metricsRef.current!.summary());
  const watchIdRef = useRef<number | null>(null);
  const gpsSyncRef = useRef<{ at: number; miles: number | null; highway: number | null; lat: number | null; lon: number | null } | null>(null);
  const gpsSyncAttemptRef = useRef(0);
  const watchGenerationRef = useRef(0);
  const speedClearTimerRef = useRef<number | null>(null);
  const trackingActiveRef = useRef(false);
  const manualTrackingRef = useRef(false);
  const autoEnabledRef = useRef(false);
  const gateRef = useRef(new DrivingGate());
  const busyRef = useRef(false);
  const playBriefingRef = useRef<(source: "manual" | "auto") => Promise<void>>(async () => undefined);
  const documentReturnTabRef = useRef<Tab>("home");
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  const refreshData = async () => {
    setMemoryLoading(true);
    setCareLoading(true);
    setIssuesLoading(true);
    setIssuesAvailable(false);
    const [vehicleResult, recordsResult, careResult, issuesResult] = await Promise.allSettled([
      api.vehicle(vehicleId), api.memory(vehicleId), api.care(vehicleId), api.majorIssues(vehicleId),
    ]);
    if (vehicleResult.status === "fulfilled") setVehicle(vehicleResult.value);
    if (recordsResult.status === "fulfilled") setRecords(recordsResult.value);
    if (careResult.status === "fulfilled") setCare(careResult.value);
    if (issuesResult.status === "fulfilled") {
      setMajorIssues(issuesResult.value);
      setIssuesAvailable(true);
    }
    if (vehicleResult.status === "rejected" || recordsResult.status === "rejected" || careResult.status === "rejected" || issuesResult.status === "rejected") {
      setError("Some vehicle information could not be refreshed. Try again.");
    }
    setMemoryLoading(false);
    setCareLoading(false);
    setIssuesLoading(false);
  };

  useEffect(() => { void refreshData(); }, [vehicleId]);
  const refreshDocuments = async () => {
    try {
      setDocuments(await listDocuments(vehicleId));
      setDocumentsError(null);
    } catch {
      setDocumentsError("Local documents are unavailable in this browser.");
    } finally { setDocumentsLoading(false); }
  };
  useEffect(() => { setDocumentsLoading(true); void refreshDocuments(); }, [vehicleId]);
  useEffect(() => { api.health().then((health) => setDemoMode(health.demo_mode)).catch(() => undefined); }, []);

  useEffect(() => {
    if (vehicle?.image_status !== "pending") return;
    const timer = window.setInterval(() => {
      api.vehicle(vehicleId).then(setVehicle).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [vehicle?.image_status, vehicleId]);

  const retryImage = async () => {
    setImageRetrying(true);
    try { setVehicle(await api.retryVehicleImage(vehicleId)); }
    catch { setError("Could not retry vehicle image generation."); }
    finally { setImageRetrying(false); }
  };

  useEffect(() => () => {
    trackingActiveRef.current = false;
    watchGenerationRef.current += 1;
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (speedClearTimerRef.current !== null) window.clearTimeout(speedClearTimerRef.current);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      metricsRef.current!.resetSegment();
      setDriveSummary(metricsRef.current!.summary());
      if (speedClearTimerRef.current !== null) window.clearTimeout(speedClearTimerRef.current);
      speedClearTimerRef.current = null;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Match Darin's consult FAB: hide while scrolling, then reveal after 500 ms idle.
  useEffect(() => {
    let revealTimer: number | undefined;
    const onScroll = () => {
      setFabHidden(true);
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => setFabHidden(false), 500);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(revealTimer);
    };
  }, []);

  const say = async (text: string) => {
    add("carmori", text);
    await voice.speak(text);
  };

  const goToTab = (next: Tab) => {
    setProfileOpen(false);
    setNotificationsOpen(false);
    setTab(next);
    if (next === "status") setDriveSummary(metricsRef.current!.summary());
    document.documentElement.scrollTop = 0;
  };

  const openDocuments = () => {
    if (tab !== "documents") documentReturnTabRef.current = tab;
    goToTab("documents");
  };

  const openRecord = (component: "washer_fluid" | "tires") => {
    setRecordComponent(component);
    setRecordOpen(true);
    goToTab("history");
  };

  const playBriefing = async (source: "manual" | "auto") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    setBriefingState("loading");
    if (source === "manual") { voice.unlockTts(); gateRef.current.markPlayed(); }
    try {
      const { text } = await api.briefing(vehicleId);
      setBriefingState("speaking");
      await say(text);
      setBriefingState("played");
      if (source === "auto") setAutoMessage("Played for this drive");
    } catch {
      setBriefingState("idle");
      setError("Could not play the briefing. Check your connection and try again.");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  playBriefingRef.current = playBriefing;

  const startVoiceChat = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!started) await onStart();
      goToTab("assistant");
    } catch {
      setError("Voice is unavailable. Check microphone permission and your connection.");
    } finally {
      setBusy(false);
    }
  };

  // GPS 기록을 서버 차량 정보로 보낸다. 2분에 한 번, 값이 바뀌었을 때만 보낸다.
  const syncGps = (fix: DriveFix, summary: DriveSummary) => {
    const now = Date.now();
    if (now - gpsSyncAttemptRef.current < 120_000) return;
    const last = gpsSyncRef.current;
    const weeklyMiles = summary.weekMeters === null ? null : Math.round(summary.weekMeters / 1609.344);
    const highway = summary.weekMeters ? Math.round((summary.weekHighwayMeters / summary.weekMeters) * 100) : null;
    // 약 1km 단위로 반올림해 보낸다. 날씨 조회에만 쓴다.
    const located = Number.isFinite(fix.accuracy) && fix.accuracy <= 1000;
    const lat = located ? Math.round(fix.latitude * 100) / 100 : null;
    const lon = located ? Math.round(fix.longitude * 100) / 100 : null;
    const moved = lat !== null && (lat !== last?.lat || lon !== last?.lon);
    const driving = weeklyMiles !== null && (weeklyMiles !== last?.miles || highway !== last?.highway);
    if (!moved && !driving) return;
    gpsSyncAttemptRef.current = now;
    api.drivingSummary(vehicleId, {
      ...(weeklyMiles !== null ? { weekly_miles: weeklyMiles, highway_percent: highway } : {}),
      ...(lat !== null && lon !== null ? { lat, lon } : {}),
    })
      .then((updated) => {
        gpsSyncRef.current = { at: now, miles: weeklyMiles, highway, lat: lat ?? last?.lat ?? null, lon: lon ?? last?.lon ?? null };
        setVehicle(updated);
        // 위치가 바뀌면 그 지역 날씨로 관리 추천을 다시 계산한다.
        if (moved) api.care(vehicleId).then(setCare).catch(() => undefined);
      })
      .catch(() => undefined);
  };

  const stopTracking = () => {
    trackingActiveRef.current = false;
    watchGenerationRef.current += 1;
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (speedClearTimerRef.current !== null) window.clearTimeout(speedClearTimerRef.current);
    speedClearTimerRef.current = null;
    metricsRef.current!.resetSegment();
    setDriveSummary(metricsRef.current!.summary());
    setTrackingEnabled(false);
    setTrackingMessage("Tracking is off");
  };

  const startTracking = (): boolean => {
    if (trackingActiveRef.current) return true;
    if (!navigator.geolocation) { setTrackingMessage("Location is unavailable in this browser"); return false; }
    metricsRef.current!.resetSegment();
    trackingActiveRef.current = true;
    const generation = ++watchGenerationRef.current;
    setTrackingEnabled(true);
    setTrackingMessage("Tracking from phone location");
    try {
      const id = navigator.geolocation.watchPosition(
        (position) => {
          if (!trackingActiveRef.current || generation !== watchGenerationRef.current) return;
          if (document.hidden) { metricsRef.current!.resetSegment(); return; }
          const fix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            timestamp: position.timestamp,
          };
          const summary = metricsRef.current!.observe(fix);
          setDriveSummary(summary);
          syncGps(fix, summary);
          if (speedClearTimerRef.current !== null) window.clearTimeout(speedClearTimerRef.current);
          speedClearTimerRef.current = window.setTimeout(() => setDriveSummary(metricsRef.current!.summary()), 21_000);
          if (autoEnabledRef.current && gateRef.current.observe(fix)) {
            setAutoMessage("Driving movement detected");
            void playBriefingRef.current("auto");
          }
        },
        (locationError) => {
          if (generation !== watchGenerationRef.current) return;
          stopTracking();
          manualTrackingRef.current = false;
          autoEnabledRef.current = false;
          setAutoEnabled(false);
          const denied = locationError.code === 1;
          setTrackingMessage(denied ? "Allow location to track your drive" : "Location signal unavailable");
          setAutoMessage(denied ? "Allow location to use auto briefing" : "Location signal unavailable. Use Hear briefing.");
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
      if (trackingActiveRef.current) watchIdRef.current = id;
      else navigator.geolocation.clearWatch(id);
      return trackingActiveRef.current;
    } catch {
      stopTracking();
      setTrackingMessage("Location could not be started");
      return false;
    }
  };

  const toggleAutoBriefing = () => {
    if (autoEnabledRef.current) {
      autoEnabledRef.current = false;
      setAutoEnabled(false);
      setAutoMessage("Enable once before your drive");
      gateRef.current.reset();
      if (!manualTrackingRef.current) stopTracking();
      return;
    }
    voice.unlockTts();
    gateRef.current.reset();
    autoEnabledRef.current = true;
    setAutoEnabled(true);
    setAutoMessage("Watching for driving movement");
    if (!startTracking()) {
      autoEnabledRef.current = false;
      setAutoEnabled(false);
      setAutoMessage("Allow location to use auto briefing");
    }
  };

  const toggleStatusTracking = () => {
    if (trackingActiveRef.current) {
      manualTrackingRef.current = false;
      autoEnabledRef.current = false;
      setAutoEnabled(false);
      setAutoMessage("Enable once before your drive");
      gateRef.current.reset();
      stopTracking();
      return;
    }
    manualTrackingRef.current = true;
    if (!startTracking()) manualTrackingRef.current = false;
  };

  const beginTask = async () => {
    setError(null);
    setBusy(true);
    try {
      await onStartTask();
    } catch {
      setError("We could not start the guide. Please try again.");
      setBusy(false);
    }
  };

  useUtterances(async (text) => {
    add("me", text);
    goToTab("assistant");
    try {
      const parsed = parseUtterance(text);
      if (parsed.kind === "start_task") {
        await say("Mount your phone so the washer fluid inlet is in view.");
        await onStartTask();
        return;
      }
      if (parsed.kind === "empty") return;
      const answer = await api.ask(vehicleId, parsed.kind === "question" ? parsed.text : text);
      await say(answer.text);
      setRecords(await api.memory(vehicleId));
    } catch {
      setError("I could not get an answer. Please ask again.");
    }
  });

  const askTypedQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const question = typedQuestion.trim();
    if (!question || asking) return;
    add("me", question);
    setTypedQuestion("");
    setAsking(true);
    try {
      const answer = await api.ask(vehicleId, question);
      add("carmori", answer.text);
    } catch {
      setError("I could not get an answer. Please try again.");
    } finally {
      setAsking(false);
    }
  };

  const weekHighway = driveSummary.weekMeters ? Math.round((driveSummary.weekHighwayMeters / driveSummary.weekMeters) * 100) : null;
  const activeCareCount = care?.recommendations.filter((item) => item.priority !== "ROUTINE").length ?? 0;
  const notificationItems = care?.recommendations.filter((item) => item.priority !== "ROUTINE") ?? [];
  const documentAlerts = documents.filter((record) => record.vehicleId === vehicleId).flatMap((record) => {
    const reminder = documentReminder(record);
    return reminder ? [{ record, reminder }] : [];
  }).sort((a, b) => a.reminder.days - b.reminder.days);
  const savedDocumentCount = documents.filter((record) => record.vehicleId === vehicleId && record.file && record.kind !== "sticker").length;
  const openNotification = (component: "washer_fluid" | "tires") => {
    goToTab("status");
    requestAnimationFrame(() => requestAnimationFrame(() =>
      document.getElementById(`status-detail-${component}`)?.click()));
  };
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: "status", label: "Status", icon: "status" },
    { id: "assistant", label: "Assistant", icon: "assistant" },
    { id: "home", label: "Home", icon: "home" },
    { id: "guide", label: "Guide", icon: "inspect" },
    { id: "history", label: "Glove box", icon: "file" },
  ];

  return <div className="app-shell">
    <main className="screen home-screen">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="car" size={27}/></span><span>Carmori</span></div>
        <div className="topbar-right">{(demoMode || vehicle?.profile_source === "demo") && <span className="demo-chip">Demo Mode</span>}<button className="topbar-alert" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="vehicle-notifications" title="Notifications"><Icon name="bell" size={18}/>{notificationItems.length + documentAlerts.length > 0 && <span className="topbar-alert-count">{notificationItems.length + documentAlerts.length}</span>}</button><button className="profile-button" type="button" onClick={() => setProfileOpen(true)} aria-label="Edit vehicle" title="Edit vehicle"><Icon name="car" size={19}/></button></div>
      </header>

      {notificationsOpen && <section className="notifications-panel" id="vehicle-notifications" aria-label="Vehicle notifications">
        <div className="notifications-heading"><div><strong>Notifications</strong></div><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="close" size={16}/></button></div>
        {(careLoading || documentsLoading) && <p className="notifications-empty">Checking saved records…</p>}
        {!careLoading && !documentsLoading && notificationItems.length + documentAlerts.length === 0 && <p className="notifications-empty">No items need your attention in saved records.</p>}
        {!careLoading && notificationItems.map((item) => <button className="notification-item" type="button" key={item.id} onClick={() => openNotification(item.component)}><span className={`notification-dot ${item.priority === "WARNING" ? "warning" : "caution"}`}/><span><strong>{item.title}</strong><small>{item.priority === "WARNING" ? "Warning" : item.priority === "CHECK_SOON" ? "Check soon" : "Needs information"}</small></span><Icon name="chevron" size={15}/></button>)}
        {documentAlerts.map(({ record, reminder }) => <button className="notification-item" type="button" key={`document-${record.kind}`} onClick={openDocuments}><span className={`notification-dot ${reminder.urgent ? "warning" : "caution"}`}/><span><strong>{DOCUMENT_KINDS.find((item) => item.kind === record.kind)?.label} renewal</strong><small>{reminder.label}</small></span><Icon name="chevron" size={15}/></button>)}
        <p className="notifications-footnote">Live dashboard alerts are not connected.</p>
      </section>}

      {profileOpen && vehicle && <VehicleEditor vehicle={vehicle} hasMajorIssues={majorIssues.length > 0} onSaved={(updated) => { setVehicle(updated); setProfileOpen(false); void refreshData(); }} onCancel={() => setProfileOpen(false)}/>}

      {!profileOpen && tab === "home" && <>
        <p className="eyebrow home-kicker">YOUR DRIVE, REMEMBERED</p>
        <section className="vehicle-briefing-card" aria-label="My vehicle and briefing">
          <div className="vehicle-briefing-top">
            <div className="vehicle-briefing-copy"><h1>{vehicle?.nickname || vehicleName(vehicle)}</h1>{vehicle?.nickname && <p className="vehicle-model">{vehicleName(vehicle)}</p>}<p className="vehicle-mileage">{vehicle?.odometer_km === null || !vehicle ? "Odometer not set" : `${Math.round(vehicle.odometer_km / 1.609344).toLocaleString()} mi`}</p><button className="vehicle-edit-link" type="button" onClick={() => setProfileOpen(true)}>Edit vehicle <Icon name="chevron" size={15}/></button></div>
            <div className="vehicle-photo-stage"><VehiclePhoto vehicle={vehicle}/></div>
          </div>
          {vehicle?.image_status === "failed" && <div className="vehicle-image-error" role="status"><span>{vehicle.image_error || "Vehicle image unavailable."}</span><button type="button" onClick={() => void retryImage()} disabled={imageRetrying}>{imageRetrying ? "Trying…" : "Retry"}</button></div>}
          <div className="vehicle-briefing-body">
          {careLoading ? <p className="vehicle-briefing-greeting">Checking saved records…</p> : activeCareCount > 0 ? <p className="vehicle-briefing-greeting">{activeCareCount} {activeCareCount === 1 ? "item" : "items"} to review</p> : null}
          <div className="vehicle-briefing-play"><div><strong>Hear briefing</strong><span>From your saved records</span></div><button className="drive-briefing-icon" type="button" onClick={() => void playBriefing("manual")} disabled={busy} aria-label="Hear briefing" title="Hear briefing"><Icon name="volume" size={23}/></button></div>
          <div className="drive-auto-row"><div><strong>Play when driving</strong><small>Uses phone location while this page is open</small></div><button type="button" role="switch" aria-checked={autoEnabled} aria-label="Auto briefing when driving" className={`drive-auto-switch${autoEnabled ? " on" : ""}`} onClick={toggleAutoBriefing}><span/>{autoEnabled ? "On" : "Off"}</button></div>
          {autoEnabled && <p className="drive-auto-status"><span className="drive-status-dot active"/>{autoMessage}</p>}
          {briefingState !== "idle" && <span className="drive-played-note" aria-live="polite">{briefingState === "loading" ? "Preparing briefing…" : briefingState === "speaking" ? "Speaking now…" : "Briefing played"}</span>}
          </div>
        </section>
        <section className="driving-insights-card"><div className="driving-insights-heading"><h2>Driving insights</h2><button type="button" onClick={toggleStatusTracking}>{trackingEnabled ? "Stop tracking" : "Start tracking"}</button></div><div className="driving-insights-grid"><div><strong>{miles(driveSummary.weekMeters)}</strong><span>Past 7 days</span></div><div><strong>{weekHighway === null ? "—" : `${weekHighway}%`}</strong><span>Highway</span></div><div><strong>{weekHighway === null ? "—" : `${100 - weekHighway}%`}</strong><span>City</span></div></div><p>{driveSummary.weekTrackedDays ? `${driveSummary.weekTrackedDays} tracked ${driveSummary.weekTrackedDays === 1 ? "day" : "days"} · Phone GPS` : trackingEnabled ? "Tracking with phone GPS" : "Track a drive to see your mileage"}{care?.environment.status === "available" ? ` · 7-day rain: ${care.environment.rainfall_mm?.toFixed(1)} mm (Open-Meteo)` : ""}</p></section>
        <section className="care-section" aria-label="Your care priorities">
          <div className="care-section-heading"><h2>Recommended checks</h2><button type="button" onClick={() => void refreshData()} aria-label="Refresh recommended checks"><Icon name="refresh" size={17}/></button></div>
          {careLoading && <div className="care-loading">Reviewing your vehicle and maintenance history…</div>}
          {!careLoading && !care && <div className="care-loading">Care priorities are unavailable. Use refresh to try again.</div>}
          {!careLoading && care?.recommendations.map((item) => <article className="care-card" key={item.id}>
            <div className="care-card-top"><span className={`care-card-icon ${item.component}`}><Icon name={item.component === "washer_fluid" ? "washer" : "status"} size={23}/></span><span className={`care-priority ${item.priority.toLowerCase()}`}>{priorityLabel(item.priority)}</span></div>
            <h3>{item.title}</h3><p>{item.explanation}</p>
            <div className="care-evidence"><strong>Based on</strong>{item.evidence.filter((evidence) => evidence.value !== "Not provided").map((evidence) => <span key={evidence.label}>{evidence.label}: {evidence.value}</span>)}</div>
            {item.unknown.length > 0 && <p className="care-unknown">Unknown: {item.unknown.join(" · ")}</p>}
            <button className="care-action" type="button" onClick={() => item.suggested_action === "washer_guide" ? void beginTask() : openRecord("tires")} disabled={busy}><span>{item.suggested_action === "washer_guide" ? "Open washer guide" : "Record tire inspection"}</span><Icon name="arrow" size={17}/></button>
          </article>)}
        </section>

      </>}

      {!profileOpen && tab === "status" && <>
        <section className="status-mileage-card" aria-label="Driving activity">
          <div className="status-mileage-heading"><h2>Mileage</h2><span className="status-mileage-source">Phone GPS</span></div>
          <div className="status-mileage-grid" aria-live="polite">
            <div><span>Today</span><strong>{miles(driveSummary.todayMeters)}</strong><small>Driven distance</small></div>
            <div><span>Typical day</span><strong>{miles(driveSummary.typicalMeters)}</strong><small>Past tracked days</small></div>
            <div><span>Speed now</span><strong>{mph(driveSummary.speedMps)}</strong><small>Current estimate</small></div>
          </div>
          <p className="status-mileage-help">{driveSummary.trackedDays ? `Typical day averages ${driveSummary.trackedDays} tracked ${driveSummary.trackedDays === 1 ? "day" : "days"} in the past 30 days.` : "Typical day appears after a previous day has been tracked."} Distance and speed are phone estimates while tracking is on.</p>
          <button className={`status-track-button${trackingEnabled ? " is-tracking" : ""}`} type="button" onClick={toggleStatusTracking}><Icon name={trackingEnabled ? "pause" : "status"} size={18}/>{trackingEnabled ? "Stop drive tracking" : "Start drive tracking"}</button>
          <p className="status-tracking-message" role="status"><span className={trackingEnabled ? "status-tracking-dot active" : "status-tracking-dot"}/>{trackingMessage}</p>
        </section>
        <Suspense fallback={<div className="status-3d-loading">Loading vehicle view…</div>}><StatusVehicle3D vehicle={vehicle} care={care} loading={careLoading}/></Suspense>
        <ServiceStatus vehicle={vehicle} records={records} care={care} loading={memoryLoading || careLoading} onSaved={refreshData} onTireInspection={() => openRecord("tires")} onWasherGuide={() => void beginTask()} guideBusy={busy}/>
      </>}

      {!profileOpen && tab === "assistant" && <>
        <section className="assistant-hero"><span className="assistant-orb"><Icon name="mic" size={25}/></span><strong>{started ? "Listening" : "Voice is off"}</strong><p>{started ? "Ask a question about your car" : "Start voice chat to use the microphone"}</p></section>
        <div className="suggestions"><span>Try asking</span><p>“Why check washer fluid?”</p><p>“What did I do earlier?”</p><p>“Where do I add washer fluid?”</p></div>
        <Captions items={captions}/>
        <form className="assistant-compose" onSubmit={(event) => void askTypedQuestion(event)}><input aria-label="Ask Carmori a question" placeholder="Ask about your car…" value={typedQuestion} onChange={(event) => setTypedQuestion(event.target.value)} maxLength={500}/><button type="submit" disabled={asking || !typedQuestion.trim()}>{asking ? "Asking…" : "Ask"}</button></form>
        {!started && <button className="primary action-button" type="button" onClick={() => void startVoiceChat()} disabled={busy}><Icon name="mic" size={20}/>Start voice chat</button>}
        {started && <button className="secondary action-button" type="button" onClick={() => void playBriefing("manual")} disabled={busy}><Icon name="volume" size={20}/>Replay briefing</button>}
      </>}

      {!profileOpen && tab === "guide" && <>
        {!tireOpen && <div className="guide-list"><section className="guide-option"><span className="guide-option-icon"><Icon name="inspect" size={22}/></span><div><h2>Washer fluid</h2><p>Locate the inlet, check the product, and follow hands-free steps.</p></div><button type="button" onClick={() => void beginTask()} disabled={busy}>Start washer guide <Icon name="arrow" size={17}/></button></section><section className="guide-option"><span className="guide-option-icon"><Icon name="status" size={22}/></span><div><h2>Tire visual check</h2><p>Photograph a tire and add gauge measurements if you have them.</p></div><button type="button" onClick={() => setTireOpen(true)}>Inspect tire <Icon name="arrow" size={17}/></button></section></div>}
        {tireOpen && vehicle && <TireInspection vehicle={vehicle} onSaved={() => { setTireOpen(false); void refreshData(); goToTab("history"); }} onCancel={() => setTireOpen(false)}/>}
      </>}

      {!profileOpen && tab === "history" && <>
        <HistorySummary vehicle={vehicle} issues={majorIssues} issuesLoading={issuesLoading} issuesAvailable={issuesAvailable} onEditVehicle={() => setProfileOpen(true)} onVehicleUpdated={setVehicle} onRefresh={refreshData}/>
        <button className="documents-shortcut" type="button" onClick={openDocuments}><span className="documents-shortcut-icon"><Icon name="file" size={21}/></span><span><strong>Driving documents</strong><small>{documentsError ? "Local storage unavailable" : documentsLoading ? "Checking this device…" : `${savedDocumentCount} of 3 quick-access copies saved`}</small></span><Icon name="chevron" size={18}/></button>
        {recordOpen && vehicle && <RecordForm key={recordComponent} vehicle={vehicle} initialComponent={recordComponent} onSaved={() => { setRecordOpen(false); void refreshData(); }} onCancel={() => setRecordOpen(false)}/>}
        <section className="history-panel"><div className="history-title"><span className="history-title-icon"><Icon name="history" size={22}/></span><div><h2>History</h2><p>{records.length} confirmed {records.length === 1 ? "record" : "records"}</p></div></div>
          <button className="history-add-button" type="button" onClick={() => { setRecordComponent("washer_fluid"); setRecordOpen(true); }}>Add completed work <Icon name="arrow" size={16}/></button>
          <div className="history-view-switch" role="group" aria-label="History view"><button type="button" className={historyView === "list" ? "selected" : ""} onClick={() => setHistoryView("list")}>List</button><button type="button" className={historyView === "calendar" ? "selected" : ""} onClick={() => setHistoryView("calendar")}>Calendar</button></div>
          {historyView === "calendar" ? <HistoryCalendar records={records} issues={issuesAvailable ? majorIssues : []}/> : <>
            {records.length === 0 && <div className="empty-state"><Icon name="history" size={30}/><strong>No records yet</strong><p>Only completed work you confirm will be saved here.</p></div>}
            {records.map((record) => <div className="history-record" key={record.record_id}><button className="history-item" type="button" onClick={() => setOpenRecordId(openRecordId === record.record_id ? null : record.record_id)} aria-expanded={openRecordId === record.record_id}><span className="history-item-dot"><Icon name="check" size={14}/></span><div><strong>{MAINTENANCE_LABELS[record.component] || record.component} {record.event_type}</strong><p>{new Date(record.completed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{record.odometer_km !== null ? ` · ${Math.round(record.odometer_km / 1.609344).toLocaleString()} mi` : ""}</p><span>{SOURCE_LABEL[record.completion_source]}{record.product_label ? ` · ${record.product_label}` : ""}</span></div><Icon name="chevron" size={16}/></button>{openRecordId === record.record_id && <div className="history-detail"><p>{record.notes || "No notes added."}</p>{record.photo_data_url && <img className="history-photo" src={record.photo_data_url} alt="Maintenance photo"/>}<small>{record.user_confirmed ? "User-confirmed completion" : "Camera-observed sequence"}</small></div>}</div>)}
          </>}
        </section>
      </>}

      {!profileOpen && tab === "documents" && <Documents vehicleId={vehicleId} records={documents.filter((record) => record.vehicleId === vehicleId)} storageError={documentsError} onChanged={refreshDocuments} onBack={() => goToTab(documentReturnTabRef.current)}/>}

      {error && tab !== "documents" && <div className="inline-error" role="alert">{error}</div>}
    </main>
    {!profileOpen && tab !== "assistant" && tab !== "documents" && <button className={`floating-mic${fabHidden ? " is-hidden" : ""}`} type="button" onClick={() => void startVoiceChat()} disabled={busy} aria-label="Ask by voice" aria-hidden={fabHidden} tabIndex={fabHidden ? -1 : 0} title="Ask by voice"><Icon name="mic" size={25}/></button>}
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id || (tab === "documents" && item.id === "history") ? "active" : ""} onClick={() => goToTab(item.id)} disabled={busy}><Icon name={item.icon} size={23}/><span>{item.label}</span></button>)}</div></nav>
  </div>;
}
