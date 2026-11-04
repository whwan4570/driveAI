import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "../components/Icons";
import { HistorySummary } from "../components/HistorySummary";
import { HistoryCalendar } from "../components/HistoryCalendar";
import { OwnerManualLink } from "../components/OwnerManualLink";
import { WasherShopping } from "../components/WasherShopping";
import { ServiceStatus } from "../components/ServiceStatus";
import { browserPermission, permissionStatusText, readPermissionSettings, requestBrowserPermission, savePermissionSetting, type AppPermission, type BrowserPermission } from "../lib/permissions";
import { CarConnection, carConnectionAvailable, readCarBriefingSetting, saveCarBriefingSetting, type CarState } from "../lib/carConnection";
import { api, type CareResponse, type MaintenanceRecord, type MajorIssue, type Vehicle } from "../lib/api";
import { parseUtterance } from "../lib/commands";
import { DrivingGate } from "../lib/drivingGate";
import { DriveMetrics, type DriveFix, type DriveSummary } from "../lib/driveMetrics";
import { PlaceVisitDetector, distanceMetres, readPlaceVisits, saveParkingSpot, savePlaceVisit, type PlaceVisitPrompt } from "../lib/placeVisits";
import { documentReminder, listDocuments, DOCUMENT_KINDS, type SavedDocument, type DocumentKind } from "../lib/documentVault";
import { MAINTENANCE_LABELS } from "../lib/serviceIntervals";
import { completeBrakeAnswer } from "../lib/manualAnswer";
import { SAMPLE_DRIVE_SUMMARY, sampleStatusCare } from "../lib/statusPreview";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";
import { Documents } from "./Documents";
import { RecordForm } from "./RecordForm";
import { Places } from "./Places";
import { TireVisualGuide } from "./TireVisualGuide";
import { VehicleEditor } from "./VehicleEditor";

type Tab = "home" | "status" | "places" | "assistant" | "guide" | "history" | "documents" | "shopping";
const StatusVehicle3D = lazy(() => import("../components/StatusVehicle3D").then((module) => ({ default: module.StatusVehicle3D })));
const SOURCE_LABEL: Record<MaintenanceRecord["completion_source"], string> = {
  observed_sequence: "Observed by camera",
  user_voice_confirmed: "Confirmed by voice",
  manual_entry: "Added manually",
};
function recordSource(record: MaintenanceRecord): string {
  return record.model_version === "fake-happy-path" ? "Simulated observation" : SOURCE_LABEL[record.completion_source];
}

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

const PRIORITY_ORDER: Record<string, number> = { WARNING: 0, CHECK_SOON: 1, INFORMATION_NEEDED: 2, ROUTINE: 3 };
// One badge color per meaning across Home: red warning, orange due soon, blue needs information.
const PRIORITY_TONE: Record<string, string> = { WARNING: "is-danger", CHECK_SOON: "is-warning", INFORMATION_NEEDED: "is-info", ROUTINE: "" };

function voiceStartMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "Microphone access is blocked. Allow it for this site and try again.";
    if (error.name === "NotFoundError") return "No microphone was found. Connect one and try again.";
    if (error.name === "NotReadableError") return "The microphone is busy. Close other apps using it and try again.";
  }
  return "Voice couldn't start. Reload the page and try again.";
}

function trackingPreferenceKey(vehicleId: string): string {
  return `carmori:drive-tracking:${vehicleId}`;
}

function settingEnabled(key: string): boolean {
  try { return localStorage.getItem(key) === "on"; } catch { return false; }
}

export function Home({ vehicleId, started, onStart, onStop, onStartTask }: {
  vehicleId: string;
  started: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onStartTask: () => Promise<void>;
}) {
  const voice = useVoice();
  const [tab, setTab] = useState<Tab>("home");
  const [serviceRequest, setServiceRequest] = useState<{ component: string; nonce: number } | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState<number | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const visualHeightRef = useRef(window.visualViewport?.height ?? window.innerHeight);
  const visualWidthRef = useRef(window.innerWidth);
  const [asking, setAsking] = useState(false);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [majorIssues, setMajorIssues] = useState<MajorIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [issuesAvailable, setIssuesAvailable] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentKind, setDocumentKind] = useState<DocumentKind | undefined>(undefined);
  const [care, setCare] = useState<CareResponse | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [careLoading, setCareLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileOriginRef = useRef<"menu" | "home" | "history">("home");
  const assistantReturnRef = useRef<Tab>("home");
  const shoppingReturnRef = useRef<Tab>("home");
  const [guideSetupOpen, setGuideSetupOpen] = useState(false);
  const [tireSetupOpen, setTireSetupOpen] = useState(false);
  const [briefingText, setBriefingText] = useState("");
  const briefingRunRef = useRef(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"menu" | "about" | "settings">("menu");
  const menuPanelRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [tireOpen, setTireOpen] = useState(false);
  const [recordComponent, setRecordComponent] = useState<"washer_fluid" | "tires">("washer_fluid");
  const [historyView, setHistoryView] = useState<"list" | "calendar">("list");
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefingState, setBriefingState] = useState<"idle" | "loading" | "speaking" | "played">("idle");

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [carBriefing, setCarBriefing] = useState(readCarBriefingSetting);
  const [perms, setPerms] = useState(readPermissionSettings);
  const [permStates, setPermStates] = useState<Record<AppPermission, BrowserPermission>>({ location: "unknown", microphone: "unknown", camera: "unknown", motion: "unknown" });
  const [autoMessage, setAutoMessage] = useState("Enable once before your drive");
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("Tracking is off");
  const [visitPrompts, setVisitPrompts] = useState(() => settingEnabled(`carmori:visit-prompts:${vehicleId}`));
  const [parkingPrompts, setParkingPrompts] = useState(() => settingEnabled(`carmori:parking-prompts:${vehicleId}`));
  const [placeVisits, setPlaceVisits] = useState(() => readPlaceVisits(vehicleId));
  const [placePrompt, setPlacePrompt] = useState<PlaceVisitPrompt | { kind: "parking"; fix: DriveFix } | null>(null);
  const placePromptRef = useRef(false);
  const visitDetectorRef = useRef(new PlaceVisitDetector(vehicleId));
  const lastFixRef = useRef<DriveFix | null>(null);
  const tripOriginRef = useRef<DriveFix | null>(null);
  const tripDistanceRef = useRef(0);
  const carConnectedRef = useRef<boolean | null>(null);
  const lastPlaceLookupRef = useRef(0);
  const metricsRef = useRef<DriveMetrics | null>(null);
  if (metricsRef.current === null) metricsRef.current = new DriveMetrics(vehicleId);
  const [driveSummary, setDriveSummary] = useState<DriveSummary>(() => metricsRef.current!.summary());
  const [samplePreview, setSamplePreview] = useState(() => new URLSearchParams(window.location.search).get("sample") === "status");
  const setPreview = (enabled: boolean) => {
    setSamplePreview(enabled);
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set("sample", "status");
    else url.searchParams.delete("sample");
    window.history.replaceState(null, "", url);
  };
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
  const playBriefingRef = useRef<(source: "manual" | "auto" | "car") => Promise<void>>(async () => undefined);
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    visitDetectorRef.current = new PlaceVisitDetector(vehicleId);
    setVisitPrompts(settingEnabled(`carmori:visit-prompts:${vehicleId}`));
    setParkingPrompts(settingEnabled(`carmori:parking-prompts:${vehicleId}`));
    setPlaceVisits(readPlaceVisits(vehicleId));
    lastPlaceLookupRef.current = 0;
    tripOriginRef.current = null;
    tripDistanceRef.current = 0;
  }, [vehicleId]);

  const offerPlacePrompt = (prompt: PlaceVisitPrompt | { kind: "parking"; fix: DriveFix }) => {
    if (placePromptRef.current) return;
    placePromptRef.current = true;
    setPlacePrompt(prompt);
  };

  const dismissPlacePrompt = () => { placePromptRef.current = false; setPlacePrompt(null); };
  const documentReturnTabRef = useRef<Tab>("home");
  const add = (who: Caption["who"], text: string, sourceUrl?: string, sourceLabel?: string) => setCaptions((c) => [...c, { who, text, sourceUrl, sourceLabel }]);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setComposerMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setComposerMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [composerMenuOpen]);

  useEffect(() => {
    if (tab !== "assistant") { setKeyboardOffset(null); return; }
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const focused = document.activeElement === composerInputRef.current;
      if (window.innerWidth !== visualWidthRef.current) {
        visualWidthRef.current = window.innerWidth;
        visualHeightRef.current = height;
      } else if (!focused) {
        visualHeightRef.current = Math.max(visualHeightRef.current, height);
      }
      const covered = Math.max(0, window.innerHeight - (viewport?.offsetTop ?? 0) - height);
      const keyboardOpen = focused && window.matchMedia("(pointer: coarse)").matches &&
        (covered > 100 || visualHeightRef.current - height > 120);
      setKeyboardOffset(keyboardOpen ? covered : null);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [tab, composerFocused]);

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

  useEffect(() => {
    if (!menuOpen) return;
    menuPanelRef.current?.querySelector<HTMLElement>("h1")?.focus();
    document.documentElement.scrollTop = 0;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, menuView]);

  const openMenu = () => {
    setNotificationsOpen(false);
    setProfileOpen(false);
    setMenuView("menu");
    setMenuOpen(true);
  };

  useEffect(() => {
    if (menuView !== "settings") return;
    let active = true;
    void Promise.all((["location", "microphone", "camera", "motion"] as const).map(async (name) => [name, await browserPermission(name)] as const))
      .then((entries) => { if (active) setPermStates(Object.fromEntries(entries) as Record<AppPermission, BrowserPermission>); });
    return () => { active = false; };
  }, [menuView]);

  const setPermission = async (permission: AppPermission, enabled: boolean) => {
    if (enabled) {
      const allowed = await requestBrowserPermission(permission);
      setPermStates((states) => ({ ...states, [permission]: allowed ? "granted" : "denied" }));
      if (!allowed) return;
    } else if (permission === "location") {
      if (autoEnabledRef.current) toggleAutoBriefing();
      if (trackingActiveRef.current) toggleStatusTracking();
    } else if (permission === "microphone" && started) {
      await onStop();
    }
    setPerms(savePermissionSetting(permission, enabled));
  };

  // A switch reads on only when Carmori may use the sensor and the browser has not blocked it.
  const permissionOn = (permission: AppPermission) => perms[permission] && permStates[permission] !== "denied";

  const openSettings = () => {
    openMenu();
    setMenuView("settings");
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuView("menu");
    menuButtonRef.current?.focus();
  };

  const say = async (text: string, sourceUrl?: string, sourceLabel?: string) => {
    add("carmori", text, sourceUrl, sourceLabel);
    lastSpokenRef.current = text;
    await voice.speak(text);
  };

  const goToTab = (next: Tab) => {
    setServiceRequest(null);
    setComposerMenuOpen(false);
    setGuideSetupOpen(false);
    setTireSetupOpen(false);
    setTireOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setMenuOpen(false);
    setMenuView("menu");
    setTab(next);
    if (next === "status") setDriveSummary(metricsRef.current!.summary());
    document.documentElement.scrollTop = 0;
  };

  const openMuse = () => {
    if (tab !== "assistant") assistantReturnRef.current = tab;
    goToTab("assistant");
  };
  const openShopping = (origin: Tab) => { shoppingReturnRef.current = origin; goToTab("shopping"); };
  const openVehicleEditor = (origin: "menu" | "home" | "history") => { profileOriginRef.current = origin; closeMenu(); setProfileOpen(true); };
  const closeVehicleEditor = () => { setProfileOpen(false); if (profileOriginRef.current === "menu") openMenu(); };
  const prepareWasherGuide = () => { goToTab("guide"); setTireOpen(false); setGuideSetupOpen(true); };
  const prepareTireGuide = () => { goToTab("guide"); setTireSetupOpen(true); };

  const openDocuments = () => {
    setDocumentKind(undefined);
    if (tab !== "documents") documentReturnTabRef.current = tab;
    goToTab("documents");
  };
  const openCareDocument = (kind: DocumentKind) => { openDocuments(); setDocumentKind(kind); };

  // The form opens above the history list, so bring it into view instead of leaving it off screen.
  useEffect(() => {
    if (!recordOpen) return;
    requestAnimationFrame(() => document.querySelector(".record-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [recordOpen]);

  const openRecord = (component: "washer_fluid" | "tires") => {
    setRecordComponent(component);
    setRecordOpen(true);
    goToTab("history");
  };

  const stopBriefing = () => {
    briefingRunRef.current += 1;
    voice.cancelSpeech();
    if (carConnectionAvailable) void CarConnection.stopSpeaking().catch(() => undefined);
    setBriefingState("idle");
    setBusy(false);
    busyRef.current = false;
  };

  const playBriefing = async (source: "manual" | "auto" | "car") => {
    if (busyRef.current) return;
    const run = ++briefingRunRef.current;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    setBriefingState("loading");
    if (source === "manual") voice.unlockTts();
    try {
      const { text } = await api.briefing(vehicleId);
      if (run !== briefingRunRef.current) return;
      setBriefingText(text);
      setBriefingState("speaking");
      if (source === "car") {
        // Native speech plays through CarPlay / Android Auto without a tap on the phone.
        add("carmori", text);
        lastSpokenRef.current = text;
        await CarConnection.speak({ text });
      } else {
        await say(text);
      }
      if (run !== briefingRunRef.current) return;
      if (source === "manual") gateRef.current.markPlayed();
      setBriefingState("played");
      if (source === "auto") setAutoMessage("Played for this drive");
    } catch {
      if (run !== briefingRunRef.current) return;
      setBriefingState("idle");
      setError("Could not play the briefing. Check your connection and try again.");
    } finally {
      if (run === briefingRunRef.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };
  playBriefingRef.current = playBriefing;

  // Native connection changes can offer a parking spot after a real trip.
  useEffect(() => {
    if (!carConnectionAvailable) return;
    let cancelled = false;
    let playedThisConnection = false;
    const onState = (state: CarState) => {
      if (cancelled) return;
      const previous = carConnectedRef.current;
      carConnectedRef.current = state.connected;
      if (!state.connected) {
        playedThisConnection = false;
        const fix = lastFixRef.current;
        if (previous && parkingPrompts && fix && fix.accuracy <= 60 && Date.now() - fix.timestamp < 120_000 && tripDistanceRef.current >= 300) {
          offerPlacePrompt({ kind: "parking", fix });
        }
        tripOriginRef.current = null;
        tripDistanceRef.current = 0;
        return;
      }
      if (!previous) { tripOriginRef.current = lastFixRef.current; tripDistanceRef.current = 0; }
      if (playedThisConnection || !carBriefing) return;
      playedThisConnection = true;
      void playBriefingRef.current("car");
    };
    const listener = CarConnection.addListener("carConnectionChange", onState);
    void CarConnection.getState().then(onState).catch(() => undefined);
    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, [carBriefing, parkingPrompts, vehicleId]);

  const startVoiceChat = async () => {
    if (!perms.microphone) { setError("Microphone is off. Turn it on in Settings to ask by voice."); return; }
    setError(null);
    setBusy(true);
    try {
      if (!started) await onStart();
      goToTab("assistant");
    } catch (error) {
      console.warn("Voice start failed", error);
      setError(voiceStartMessage(error));
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
    setPreview(false);
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
          lastFixRef.current = fix;
          if (carConnectedRef.current) {
            if (!tripOriginRef.current && fix.accuracy <= 60) tripOriginRef.current = fix;
            if (tripOriginRef.current && fix.accuracy <= 60) tripDistanceRef.current = Math.max(tripDistanceRef.current, distanceMetres(tripOriginRef.current, fix));
          }
          const summary = metricsRef.current!.observe(fix);
          setDriveSummary(summary);
          syncGps(fix, summary);
          if (visitPrompts && !placePromptRef.current) {
            if (fix.accuracy <= 60 && (fix.speed ?? 0) <= 1.5 && Date.now() - lastPlaceLookupRef.current > 120_000) {
              lastPlaceLookupRef.current = Date.now();
              void api.nearbyPlaces(fix.latitude, fix.longitude)
                .then(({ places }) => visitDetectorRef.current.setNearby(places))
                .catch(() => visitDetectorRef.current.setNearby([]));
            }
            const prompt = visitDetectorRef.current.observe(fix);
            if (prompt) offerPlacePrompt(prompt);
          }
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
      try { localStorage.removeItem(trackingPreferenceKey(vehicleId)); } catch { /* Continue stopping this session. */ }
      manualTrackingRef.current = false;
      autoEnabledRef.current = false;
      setAutoEnabled(false);
      setAutoMessage("Enable once before your drive");
      gateRef.current.reset();
      stopTracking();
      return;
    }
    manualTrackingRef.current = true;
    if (startTracking()) {
      try { localStorage.setItem(trackingPreferenceKey(vehicleId), "on"); } catch { /* Continue tracking this session. */ }
    } else {
      manualTrackingRef.current = false;
    }
  };

  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(trackingPreferenceKey(vehicleId)) === "on"; } catch { /* Use the default off state. */ }
    if (saved && readPermissionSettings().location) {
      manualTrackingRef.current = true;
      if (!startTracking()) manualTrackingRef.current = false;
    }
  }, [vehicleId]);

  const beginTask = async () => {
    if (!perms.camera) { setError("Camera is off. Turn it on in Settings to use the washer guide."); return; }
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
    setError(null);
    add("me", text);
    goToTab("assistant");
    try {
      if (/^(?:please )?(?:brief me|give me (?:my |the )?briefing|what(?:'s| is) (?:my |the )?briefing|play (?:my |the )?briefing)[.!?]?$/i.test(text.trim())) {
        await playBriefing("manual");
        return;
      }
      const parsed = parseUtterance(text);
      if (parsed.kind === "start_task") {
        await say("Mount your phone so the washer fluid inlet is in view.");
        await onStartTask();
        return;
      }
      if (parsed.kind === "empty") return;
      if (parsed.kind === "session") {
        if (parsed.intent === "REPEAT") await say(lastSpokenRef.current ?? "Nothing to repeat yet.");
        else await say("Open the washer guide to use that command.");
        return;
      }
      const answer = completeBrakeAnswer(await api.ask(vehicleId, parsed.text), parsed.text, vehicle, records);
      await say(answer.text, answer.source_url ?? undefined, answer.source_label ?? undefined);
      void api.memory(vehicleId).then(setRecords).catch(() => undefined);
    } catch {
      setError("I could not get an answer. Please ask again.");
    }
  }, (issue) => setError(issue === "empty" ? "I didn't catch that. Please try again." : "Voice transcription failed. Check your connection and try again."));

  const submitQuestion = async (question: string) => {
    if (!question || asking) return;
    add("me", question);
    setTypedQuestion("");
    setAsking(true);
    try {
      const answer = completeBrakeAnswer(await api.ask(vehicleId, question), question, vehicle, records);
      add("carmori", answer.text, answer.source_url ?? undefined, answer.source_label ?? undefined);
    } catch {
      setError("I could not get an answer. Please try again.");
    } finally {
      setAsking(false);
    }
  };

  const askTypedQuestion = async (event: FormEvent) => {
    event.preventDefault();
    await submitQuestion(typedQuestion.trim());
  };

  const askMuseToShop = () => {
    assistantReturnRef.current = "shopping";
    goToTab("assistant");
    void submitQuestion("Which washer fluid fits today's weather? Have you checked current prices and reviews, or bought anything for me?");
  };

  const shownDriveSummary = samplePreview ? SAMPLE_DRIVE_SUMMARY : driveSummary;
  const shownStatusCare = samplePreview ? sampleStatusCare(care) : care;
  const weekHighway = shownDriveSummary.weekMeters ? Math.round((shownDriveSummary.weekHighwayMeters / shownDriveSummary.weekMeters) * 100) : null;

  const notificationItems = (care?.recommendations.filter((item) => item.priority !== "ROUTINE") ?? [])
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const documentAlerts = documents.filter((record) => record.vehicleId === vehicleId).flatMap((record) => {
    const reminder = documentReminder(record);
    return reminder ? [{ record, reminder }] : [];
  }).sort((a, b) => a.reminder.days - b.reminder.days);
  const savedDocumentCount = documents.filter((record) => record.vehicleId === vehicleId && record.file && ["license", "registration", "insurance"].includes(record.kind)).length;
  const openServiceDetail = (component: string) => {
    goToTab("status");
    setServiceRequest({ component, nonce: Date.now() });
  };
  const openNotification = openServiceDetail;
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: "status", label: "Status", icon: "activity" },
    { id: "places", label: "Places", icon: "pin" },
    { id: "home", label: "Home", icon: "home" },
    { id: "guide", label: "Guide", icon: "scan" },
    { id: "history", label: "Glove box", icon: "folder" },
  ];

  return <div className={`app-shell${keyboardOffset !== null ? " assistant-keyboard-open" : ""}`}>
    <main className={`screen home-screen${tab === "assistant" ? " assistant-screen" : ""}${profileOpen || tab !== "assistant" ? " is-k-home" : ""}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="car" size={27}/></span><span>Carmori</span></div>
        <div className="topbar-right">{(demoMode || vehicle?.profile_source === "demo") && <span className="demo-chip">{demoMode ? "Demo Mode" : "Sample vehicle"}</span>}<button className="muse-header-button" type="button" onClick={openMuse} aria-label="Talk to Muse"><Icon name="spark" size={16}/>Muse</button><button className="topbar-alert" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="vehicle-notifications" title="Notifications"><Icon name="bell" size={20}/>{notificationItems.length + documentAlerts.length > 0 && <span className="topbar-alert-count">{notificationItems.length + documentAlerts.length}</span>}</button><button ref={menuButtonRef} className="profile-button" type="button" onClick={openMenu} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="carmori-side-menu" title="Menu"><Icon name="menu" size={22}/></button></div>
      </header>
      {samplePreview && <div className="sample-preview-banner" role="status"><span>Sample data preview · Your records are unchanged</span><button type="button" onClick={() => setPreview(false)}>Exit</button></div>}

      {notificationsOpen && <section className="notifications-panel" id="vehicle-notifications" aria-label="Vehicle notifications">
        <div className="notifications-heading"><div><strong>Notifications</strong></div><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="close" size={16}/></button></div>
        {(careLoading || documentsLoading) && <p className="notifications-empty">Checking saved records…</p>}
        {!careLoading && !documentsLoading && notificationItems.length + documentAlerts.length === 0 && <p className="notifications-empty">No items need your attention in saved records.</p>}
        {!careLoading && notificationItems.map((item) => <button className="notification-item" type="button" key={item.id} onClick={() => { if (item.component === "washer_fluid") prepareWasherGuide(); else if (item.component === "tires") prepareTireGuide(); else openNotification(item.component); }}><span className={`notification-dot ${item.priority === "WARNING" ? "warning" : "caution"}`}/><span><strong>{item.title}</strong><small>{item.priority === "WARNING" ? "Warning" : item.priority === "CHECK_SOON" ? "Check soon" : "Needs information"}</small></span><Icon name="chevron" size={15}/></button>)}
        {documentAlerts.map(({ record, reminder }) => <button className="notification-item" type="button" key={`document-${record.kind}`} onClick={openDocuments}><span className={`notification-dot ${reminder.urgent ? "warning" : "caution"}`}/><span><strong>{DOCUMENT_KINDS.find((item) => item.kind === record.kind)?.label} renewal</strong><small>{reminder.label}</small></span><Icon name="chevron" size={15}/></button>)}
        <p className="notifications-footnote">Live dashboard alerts are not connected.</p>
      </section>}

      <div className="page-content" hidden={menuOpen}>
      {profileOpen && vehicle && <VehicleEditor vehicle={vehicle} hasMajorIssues={majorIssues.length > 0} onSaved={(updated) => { setVehicle(updated); closeVehicleEditor(); void refreshData(); }} onCancel={closeVehicleEditor} backLabel={profileOriginRef.current === "menu" ? "Menu" : profileOriginRef.current === "history" ? "Glove box" : "Home"}/>}

      {!profileOpen && tab === "home" && <div className="k-home home-overview">
        <section className="overview-car" aria-label="My vehicle">
          <div className="overview-car-heading"><div><h1>{vehicle?.nickname || vehicleName(vehicle)}</h1>{vehicle?.nickname && <p>{vehicleName(vehicle)}</p>}</div><button className="overview-edit" type="button" onClick={() => openVehicleEditor("home")} aria-label="View and edit my vehicle"><Icon name="settings" size={18}/></button></div>
          <Suspense fallback={<div className="status-3d-loading">Loading vehicle view…</div>}><StatusVehicle3D vehicle={vehicle} records={records} care={shownStatusCare} loading={memoryLoading || careLoading} samplePreview={samplePreview} showHeader={false} onViewDetails={openServiceDetail}/></Suspense>
          <div className="overview-mileage"><strong>{vehicle?.odometer_km == null ? "—" : Math.round(vehicle.odometer_km / 1.609344).toLocaleString()} {vehicle?.odometer_km == null ? "" : "mi"}</strong><small>{vehicle?.odometer_km == null ? "Add odometer in My vehicle" : "Last recorded odometer"}</small></div>
        </section>
        <section className="overview-briefing" aria-label="Your car summary"><Icon name="volume" size={20}/><div><strong>Hear your car summary</strong><small role="status">{briefingState === "loading" ? "Preparing your summary…" : briefingState === "speaking" ? "Speaking · Tap Stop to end" : "Saved records & suggested checks"}</small></div><button type="button" onClick={() => briefingState === "loading" || briefingState === "speaking" ? stopBriefing() : void playBriefing("manual")} disabled={busy && briefingState !== "loading" && briefingState !== "speaking"} aria-label={briefingState === "loading" || briefingState === "speaking" ? "Stop reading summary" : "Play car summary"}>{briefingState === "loading" || briefingState === "speaking" ? <span aria-hidden="true">■</span> : <Icon name="play" size={20}/>}</button></section>
        {briefingText && <details className="overview-transcript"><summary>Read the summary</summary><p>{briefingText}</p></details>}
        <section className="k-block is-list overview-checks" aria-label="Suggested checks">
          <div className="k-block-head"><h2 className="k-h2">Suggested checks</h2><button className="k-block-link" type="button" onClick={() => goToTab("status")}>View all<Icon name="chevron" size={14}/></button></div>
          {careLoading && <p className="k-note" role="status">Checking saved records…</p>}
          {!careLoading && notificationItems.length === 0 && <p className="k-note">Nothing to review in your saved records.</p>}
          {notificationItems.slice(0, 2).map((item) => <div key={item.id}><button className="k-row" type="button" onClick={() => { if (item.component === "washer_fluid") prepareWasherGuide(); else if (item.component === "tires") prepareTireGuide(); else openNotification(item.component); }}><span className={`k-row-art ${item.component}`}><Icon name={item.component === "washer_fluid" ? "droplets" : item.component === "tires" ? "tire" : "status"} size={21}/></span><span className="k-row-main"><strong>{item.title}</strong><small>{item.last_recorded_at ? `Last recorded ${new Date(item.last_recorded_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : "No confirmed record yet"}</small></span><span className={`k-badge ${PRIORITY_TONE[item.priority]}`}>{priorityLabel(item.priority)}</span><Icon className="k-row-trail" name="chevron" size={15}/></button>{item.component === "washer_fluid" && <button className="muse-product-suggestion" type="button" onClick={() => openShopping("home")}><Icon name="spark" size={13}/><span>Explore fluid options with Muse</span><Icon name="chevron" size={12}/></button>}</div>)}
        </section>
      </div>}

      {!profileOpen && tab === "status" && <div className="k-home k-status">
        <header className="k-hero">
          <h1 className="k-title">Status</h1>
          <p className="k-lead">Review checks and keep your service history current.</p>
        </header>
        <ServiceStatus detailRequest={serviceRequest} vehicle={vehicle} records={records} care={shownStatusCare} loading={memoryLoading || careLoading} onSaved={refreshData} onTireInspection={() => openRecord("tires")} onWasherGuide={prepareWasherGuide} onFindProduct={() => openShopping("status")} guideBusy={busy} samplePreview={samplePreview}/>
        <details className="k-block driving-details"><summary>Driving & environment</summary>
          <div className="k-block-title"><h2 className="k-h2">Mileage</h2>{samplePreview && <span className="k-badge">Sample data</span>}</div>
          {samplePreview || trackingEnabled || shownDriveSummary.todayMeters !== null || shownDriveSummary.typicalMeters !== null ? <>
            <div className="k-facts" aria-live="polite">
              <div><b>{miles(shownDriveSummary.todayMeters)}</b><span>Today</span></div>
              <div><b>{miles(shownDriveSummary.typicalMeters)}</b><span>Typical day</span></div>
              <div><b>{mph(shownDriveSummary.speedMps)}</b><span>Speed now</span></div>
            </div>
            <p className="k-note">{samplePreview ? "Sample distances and speed. Your saved drives are unchanged." : trackingEnabled ? trackingMessage : driveSummary.trackedDays ? `Typical day averages ${driveSummary.trackedDays} tracked ${driveSummary.trackedDays === 1 ? "day" : "days"} in the past 30 days.` : "Typical day appears after a previous day is tracked."}</p>
          </> : <div className="k-empty-row">
            <p>Drive tracking is off.</p>
            <button className="k-block-link" type="button" onClick={openSettings}>Turn on in Settings<Icon name="chevron" size={14}/></button>
          </div>}
                  <div className="k-facts"><div><b>{miles(shownDriveSummary.weekMeters)}</b><span>This week</span></div><div><b>{weekHighway == null ? "—" : `${weekHighway}%`}</b><span>Highway</span></div><div><b>{!samplePreview && care?.environment.status === "available" && care.environment.rainfall_mm != null ? `${care.environment.rainfall_mm.toFixed(1)} mm` : "—"}</b><span>Rain, 7 days</span></div></div>
        </details>
      </div>}

      {!profileOpen && tab === "places" && <div className="k-home">
        <header className="k-hero"><h1 className="k-title">Places</h1><p className="k-lead">Nearby care and your saved stops</p></header>
        <Places key={vehicleId} vehicleId={vehicleId} locationAllowed={perms.location} cameraAllowed={perms.camera} compassAllowed={perms.motion}/>
      </div>}

      {!profileOpen && tab === "shopping" && <div className="k-home"><button className="context-back" type="button" onClick={() => goToTab(shoppingReturnRef.current)}>‹ Back</button><WasherShopping vehicleId={vehicleId} care={care} onAskMuse={askMuseToShop}/></div>}
      {!profileOpen && tab === "assistant" && <>
        <div className="muse-chat-heading"><button className="context-back" type="button" onClick={() => goToTab(assistantReturnRef.current)}>‹ Back</button><h1>Muse</h1><p>Ask about {vehicle?.nickname || vehicleName(vehicle)}</p></div>
        {captions.length === 0 && <section className="muse-welcome"><p>Ask about your records, next checks, or a task.</p><div className="muse-prompts">{["Why should I check?", "What did I do earlier?", "Where do I put washer fluid?"].map((question) => <button type="button" key={question} onClick={() => void submitQuestion(question)} disabled={asking}>{question}</button>)}</div></section>}
        <Captions items={captions}/>
        <form ref={composerRef} className="assistant-compose" style={keyboardOffset !== null ? { bottom: `${keyboardOffset + 8}px` } : undefined} onSubmit={(event) => void askTypedQuestion(event)}>
          <button className="assistant-plus" type="button" onClick={() => setComposerMenuOpen((open) => !open)} aria-label="More actions" aria-expanded={composerMenuOpen} aria-controls="assistant-composer-menu"><Icon name="plus" size={20}/></button>
          <input ref={composerInputRef} aria-label="Message Muse" placeholder="Ask about your car…" value={typedQuestion} onChange={(event) => setTypedQuestion(event.target.value)} onFocus={() => { setComposerFocused(true); setComposerMenuOpen(false); if (started) void onStop(); }} onBlur={() => setComposerFocused(false)} maxLength={500}/>
          {typedQuestion.trim() ? <button className="assistant-send" type="submit" disabled={asking} aria-label="Send question">{asking ? "…" : "Ask"}</button> : !composerFocused && perms.microphone && <button className={`assistant-mic${started ? " is-listening" : ""}`} type="button" onClick={() => void (started ? onStop() : startVoiceChat())} disabled={busy} aria-label={started ? "Stop listening" : "Start voice chat"} aria-pressed={started}><Icon name={started ? "pause" : "mic"} size={22}/></button>}
          {composerMenuOpen && <div className="assistant-composer-menu" id="assistant-composer-menu"><button type="button" onClick={() => { setComposerMenuOpen(false); goToTab("guide"); }}><Icon name="camera" size={18}/>Camera guide</button><button type="button" onClick={() => { setComposerMenuOpen(false); openDocuments(); }}><Icon name="file" size={18}/>Add document</button></div>}
        </form>
      </>}

      {!profileOpen && tab === "guide" && <div className="k-home">
        {!tireOpen && !guideSetupOpen && !tireSetupOpen && <>
          <header className="k-hero"><h1 className="k-title">Guide</h1><p className="k-lead">Step-by-step checks with your phone</p></header>
          <section className="k-block is-list" aria-label="Guided checks">
            <button className="k-row" type="button" onClick={prepareWasherGuide} disabled={busy}>
              <span className="k-row-art washer_fluid"><Icon name="washer" size={22}/></span>
              <span className="k-row-main"><strong>Washer fluid</strong><small>{perms.camera ? "Find the inlet, check the product, refill hands-free" : "Camera is off in Settings"}</small></span>
              <Icon className="k-row-trail" name="chevron" size={18}/>
            </button>
            <button className="k-row" type="button" onClick={prepareTireGuide}>
              <span className="k-row-art"><Icon name="status" size={22}/></span>
              <span className="k-row-main"><strong>Tire visual check</strong><small>Check all four tires with automatic sidewall and tread scans</small></span>
              <Icon className="k-row-trail" name="chevron" size={18}/>
            </button>
          </section>
        </>}
        {guideSetupOpen && <section className="guide-setup"><button className="context-back" type="button" onClick={() => setGuideSetupOpen(false)}>‹ Guide</button><h1>Washer-fluid guide</h1><p>Set up once, then follow the hands-free steps.</p><ol><li><strong>Position your phone</strong><span>Keep your hands, cap and bottle in view.</span></li><li><strong>Camera & microphone</strong><span>Camera is required. Microphone enables voice questions.</span></li><li><strong>Follow the spoken steps</strong><span>Unclear observations stay on the current step.</span></li></ol>{demoMode && <p className="sample-preview-banner">Demo Mode simulates observations. It does not verify real work.</p>}<button className="primary action-button" type="button" onClick={() => perms.camera ? void beginTask() : openSettings()} disabled={busy}>{busy ? "Starting…" : perms.camera ? demoMode ? "Start demo guide" : "Start guide" : "Enable camera in Settings"}</button><button className="k-block-link" type="button" onClick={() => openShopping("guide")}><Icon name="spark" size={16}/>Need a product? Ask Muse</button></section>}
        {tireSetupOpen && <section className="guide-setup"><button className="context-back" type="button" onClick={() => setTireSetupOpen(false)}>‹ Guide</button><h1>Tire visual check</h1><p>Get ready, then check all four tires one at a time.</p><ol><li><strong>Walk around your parked car</strong><span>Keep the car stationary and make sure you can safely reach each wheel.</span></li><li><strong>Capture sidewall & tread views</strong><span>Follow the camera prompts for two views per tire—eight views in total. You can also upload photos.</span></li><li><strong>Review and save your observations</strong><span>Retake unclear views before saving. Photos do not measure tire pressure or tread depth.</span></li></ol>{demoMode && <p className="sample-preview-banner">Demo Mode uses simulated analysis. It does not verify real tire condition.</p>}<button className="primary action-button" type="button" onClick={() => { void voice.speak("Start at the driver's front tire. Show the whole outer sidewall."); setTireSetupOpen(false); setTireOpen(true); }} disabled={busy}>Start tire check</button></section>}
        {tireOpen && vehicle && <TireVisualGuide vehicle={vehicle} onSaved={() => { setTireOpen(false); void refreshData(); goToTab("history"); }} onCancel={() => { setTireOpen(false); setTireSetupOpen(true); }}/>}
      </div>}

      {!profileOpen && tab === "history" && <div className="k-home">
        <header className="k-hero"><h1 className="k-title">Glove box</h1><p className="k-lead">Your car’s documents and care history.</p></header>
        <div className="glove-documents-heading"><h2>Documents</h2><button type="button" onClick={openDocuments}>+ Add</button></div>

        <section className="k-block is-list glove-documents" aria-label="Documents"><button className="k-row" type="button" onClick={openDocuments}><span className="k-row-art"><Icon name="files" size={22}/></span><span className="k-row-main"><strong>Driving documents</strong><small>{documentsError ? "Local storage unavailable" : documentsLoading ? "Checking this device…" : `Insurance, registration & license · ${savedDocumentCount}/3 saved${documentAlerts[0] ? ` · ${DOCUMENT_KINDS.find((item) => item.kind === documentAlerts[0].record.kind)?.shortLabel} ${documentAlerts[0].reminder.label.toLowerCase()}` : ""}`}</small></span><Icon className="k-row-trail" name="chevron" size={18}/></button><OwnerManualLink vehicle={vehicle}/><div className="glove-reference-documents"><details><summary>Purchase & service documents</summary><button className="k-row" type="button" onClick={() => openCareDocument("purchase")}><span className="k-row-art"><Icon name="file" size={20}/></span><span className="k-row-main"><strong>Purchase document</strong><small>Saved locally on this device</small></span><Icon name="chevron" size={15}/></button><button className="k-row" type="button" onClick={() => openCareDocument("receipt")}><span className="k-row-art"><Icon name="history" size={20}/></span><span className="k-row-main"><strong>Service receipt</strong><small>Keep the latest supporting document</small></span><Icon name="chevron" size={15}/></button></details></div></section>
        {recordOpen && vehicle && <RecordForm key={recordComponent} vehicle={vehicle} initialComponent={recordComponent} onSaved={() => { setRecordOpen(false); void refreshData(); }} onCancel={() => setRecordOpen(false)}/>}
        <section className="k-block is-list history-block" aria-label="History"><div className="k-block-head"><h2 className="k-h2">Care history</h2><span className="k-block-count">{records.length + placeVisits.length ? `${records.length + placeVisits.length} confirmed` : "No completed work yet"}</span></div>
          <div className="history-view-switch" role="group" aria-label="History view"><button type="button" className={historyView === "list" ? "selected" : ""} onClick={() => setHistoryView("list")}><Icon name="list" size={15}/> List</button><button type="button" className={historyView === "calendar" ? "selected" : ""} onClick={() => setHistoryView("calendar")}><Icon name="calendar" size={15}/> Calendar</button></div>
          {historyView === "calendar" ? <HistoryCalendar records={records} issues={issuesAvailable ? majorIssues : []}/> : <>
            {records.length === 0 && placeVisits.length === 0 && <div className="empty-state"><Icon name="history" size={18}/><strong>No care records yet</strong><p>Save completed work to build your car’s history.</p></div>}
            {placeVisits.map((visit) => <div className="history-record" key={visit.id}><div className="history-item"><span className="history-item-dot"><Icon name="check" size={14}/></span><div><strong>{visit.category === "fuel" ? "Refueled" : visit.category === "repair" ? "Service visit" : "Car wash"}</strong><p>{new Date(visit.confirmedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p><span>{visit.name} · Confirmed by you</span></div></div></div>)}
            {records.map((record) => <div className="history-record" key={record.record_id}><button className="history-item" type="button" onClick={() => setOpenRecordId(openRecordId === record.record_id ? null : record.record_id)} aria-expanded={openRecordId === record.record_id}><span className="history-item-dot"><Icon name="check" size={14}/></span><div><strong>{MAINTENANCE_LABELS[record.component] || record.component} {record.event_type}</strong><p>{new Date(record.completed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{record.odometer_km !== null ? ` · ${Math.round(record.odometer_km / 1.609344).toLocaleString()} mi` : ""}</p><span>{recordSource(record)}{record.product_label ? ` · ${record.product_label}` : ""}</span></div>{record.photo_data_url && <img className="history-thumb" src={record.photo_data_url} alt="Saved maintenance"/>}<Icon name="chevron" size={16}/></button>{openRecordId === record.record_id && <div className="history-detail"><p>{record.notes || "No notes added."}</p>{record.photo_data_url && <img className="history-photo" src={record.photo_data_url} alt="Maintenance photo"/>}<small>Completion: {recordSource(record)}{record.flow_observed && record.completion_source === "observed_sequence" && record.model_version !== "fake-happy-path" ? " · Pour observed by camera" : ""}{record.evidence_frames?.length ? " · Observation references saved" : ""}</small></div>}</div>)}
          </>}
          <button className="k-row is-add" type="button" onClick={() => { setRecordComponent("washer_fluid"); setRecordOpen(true); }}><span className="k-row-art"><Icon name="plus" size={22}/></span><span className="k-row-main"><strong>Add completed work</strong></span></button>
        </section>
        <details className="ownership-details"><summary>Your time with this car</summary>
        <HistorySummary vehicle={vehicle} issues={majorIssues} issuesLoading={issuesLoading} issuesAvailable={issuesAvailable} onEditVehicle={() => openVehicleEditor("history")} onVehicleUpdated={setVehicle} onRefresh={refreshData}/>
        </details>
      </div>}

      {!profileOpen && tab === "documents" && <Documents key={`${vehicleId}:${documentKind ?? "all"}`} initialKind={documentKind} vehicleId={vehicleId} records={documents.filter((record) => record.vehicleId === vehicleId)} storageError={documentsError} onChanged={refreshDocuments} onBack={() => goToTab(documentReturnTabRef.current)}/>}

      {error && tab !== "documents" && <div className="inline-error" role="alert">{error}</div>}
      </div>
      {menuOpen && <section ref={menuPanelRef} className="menu-page k-home" id="carmori-side-menu" aria-label={menuView === "menu" ? "Menu" : menuView === "about" ? "About Carmori" : "Settings"}>
        {menuView !== "menu" && <button className="context-back" type="button" onClick={() => setMenuView("menu")}>‹ Menu</button>}
        <header className="menu-page-heading"><div><p className="k-eyebrow">CARMORI</p><h1 className="k-title" tabIndex={-1}>{menuView === "menu" ? "Menu" : menuView === "about" ? "About Carmori" : "Settings"}</h1></div><button className="menu-page-close" type="button" onClick={closeMenu} aria-label="Close menu"><Icon name="close" size={18}/></button></header>
        {menuView === "menu" ? <>
          <p className="k-lead">Your car, preferences and app controls.</p>
          <section className="k-block is-list" aria-label="Menu options">
            <button className="k-row" type="button" onClick={() => openVehicleEditor("menu")}><span className="k-row-art"><Icon name="car" size={18}/></span><span className="k-row-main"><strong>My vehicle</strong><small>{vehicleName(vehicle)}{vehicle?.trim ? ` · ${vehicle.trim}` : ""}</small></span><Icon className="k-row-trail" name="chevron" size={16}/></button>
            <button className="k-row" type="button" onClick={() => setMenuView("settings")}><span className="k-row-art"><Icon name="controls" size={18}/></span><span className="k-row-main"><strong>Settings</strong><small>Location, voice, camera and preferences</small></span><Icon className="k-row-trail" name="chevron" size={16}/></button>
            <button className="k-row" type="button" onClick={() => setMenuView("about")}><span className="k-row-art"><Icon name="info" size={18}/></span><span className="k-row-main"><strong>About Carmori</strong><small>App information and privacy</small></span><Icon className="k-row-trail" name="chevron" size={16}/></button>
          </section>
        </> : menuView === "about" ? <section className="k-block about-carmori"><h2>Care for your car, one step at a time.</h2><p>Carmori brings together your vehicle records, maintenance prompts and guided checks.</p><h2>Your data</h2><p>Documents and saved places stay in this browser. Vehicle details and confirmed maintenance records are saved by the Carmori service.</p><p>When you use camera or voice features, images or audio may be sent to the configured AI service. Location-based place prompts use OpenStreetMap when enabled in Settings.</p><h2>Guidance and records</h2><p>Missing records do not indicate a fault. Service estimates are schedule prompts, not measurements of component condition. Confirm completed work before saving it.</p></section> : <div className="side-menu-settings settings-list">
              <details className="settings-disclosure" open><summary><strong>Location & driving</strong><small>Location, trips and automatic actions</small></summary>
              <div className="settings-row"><span><strong>Location</strong><small>{permissionStatusText(perms.location, permStates.location)}</small></span><button type="button" role="switch" className="k-switch" aria-checked={permissionOn("location")} aria-label="Location access" disabled={false} onClick={() => void setPermission("location", !permissionOn("location"))}/></div>
              <div className="settings-row"><span><strong>Drive tracking</strong><small>{perms.location ? trackingMessage : "Needs location"}</small></span><button type="button" role="switch" className="k-switch" aria-checked={trackingEnabled} aria-label="Drive tracking" disabled={!perms.location} onClick={toggleStatusTracking}/></div>
              <div className="settings-row"><span><strong>Ask after a place visit</strong><small>When stopped near a gas station, repair shop, or car wash. Sends your location to OpenStreetMap while on.</small></span><button type="button" role="switch" className="k-switch" aria-checked={visitPrompts} aria-label="Ask after a place visit" disabled={!perms.location || !trackingEnabled} onClick={() => { const next = !visitPrompts; localStorage.setItem(`carmori:visit-prompts:${vehicleId}`, next ? "on" : "off"); setVisitPrompts(next); if (!next) visitDetectorRef.current.setNearby([]); }}/></div>
              {carConnectionAvailable && <div className="settings-row"><span><strong>Remember parking</strong><small>Ask after CarPlay or Android Auto disconnects following a drive. Saves only after you confirm.</small></span><button type="button" role="switch" className="k-switch" aria-checked={parkingPrompts} aria-label="Remember parking" disabled={!perms.location || !trackingEnabled} onClick={() => { const next = !parkingPrompts; localStorage.setItem(`carmori:parking-prompts:${vehicleId}`, next ? "on" : "off"); setParkingPrompts(next); }}/></div>}
              <div className="settings-row"><span><strong>Play briefing when driving</strong><small>{perms.location ? (autoEnabled ? autoMessage : "Plays once driving movement is detected") : "Needs location"}</small></span><button type="button" role="switch" className="k-switch" aria-checked={autoEnabled} aria-label="Play briefing when driving" disabled={!perms.location} onClick={toggleAutoBriefing}/></div>
              <div className="settings-row"><span><strong>Compass</strong><small>{perms.motion ? "Points Find my car toward your car" : "Off · Find my car shows distance only"}</small></span><button type="button" role="switch" className="k-switch" aria-checked={perms.motion} aria-label="Compass access" onClick={() => void setPermission("motion", !perms.motion)}/></div>
              </details><details className="settings-disclosure"><summary><strong>Voice & camera</strong><small>Conversation and guided checks</small></summary>
              <div className="settings-row"><span><strong>Microphone</strong><small>{perms.microphone ? `${permissionStatusText(true, permStates.microphone)} · Ask by voice and hands-free guide` : permissionStatusText(false, permStates.microphone)}</small></span><button type="button" role="switch" className="k-switch" aria-checked={permissionOn("microphone")} aria-label="Microphone access" disabled={false} onClick={() => void setPermission("microphone", !permissionOn("microphone"))}/></div>
              {carConnectionAvailable && <>
              <div className="settings-row"><span><strong>Play briefing when car connects</strong><small>{"CarPlay or Android Auto, while Carmori is open"}</small></span><button type="button" role="switch" className="k-switch" aria-checked={carBriefing} aria-label="Play briefing when car connects" disabled={false} onClick={() => { saveCarBriefingSetting(!carBriefing); setCarBriefing(!carBriefing); }}/></div>
              </>}

              <div className="settings-row"><span><strong>Camera</strong><small>{perms.camera ? `${permissionStatusText(true, permStates.camera)} · Washer guide and scans` : permissionStatusText(false, permStates.camera)}</small></span><button type="button" role="switch" className="k-switch" aria-checked={permissionOn("camera")} aria-label="Camera access" disabled={false} onClick={() => void setPermission("camera", !permissionOn("camera"))}/></div>
              </details><details className="settings-disclosure"><summary><strong>Display & preview</strong><small>Sample indicators</small></summary>
              <div className="settings-row"><span><strong>Sample data preview</strong><small>{"Shows sample indicators. Records stay unchanged."}</small></span><button type="button" role="switch" className="k-switch" aria-checked={samplePreview} aria-label="Sample data preview" disabled={false} onClick={() => setPreview(!samplePreview)}/></div>
          </details></div>}
      </section>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id || (tab === "documents" && item.id === "history") ? "active" : ""} onClick={() => goToTab(item.id)} disabled={busy}><Icon name={item.icon} size={23}/><span>{item.label}</span></button>)}</div></nav>
    {placePrompt && <div className="place-prompt-backdrop" role="presentation"><section className="place-prompt" role="dialog" aria-modal="true" aria-labelledby="place-prompt-title"><span className="place-prompt-kicker">{placePrompt.kind === "parking" ? "Parked car" : placePrompt.name}</span><h2 id="place-prompt-title">{placePrompt.kind === "parking" ? "Remember this parking spot?" : placePrompt.category === "fuel" ? "Did you refuel?" : placePrompt.category === "repair" ? "Did you get service?" : "Did you wash your car?"}</h2><p>{placePrompt.kind === "parking" ? "Car connection ended after a drive. Save your last phone location in Places?" : "You stopped near this place. Save a visit only if it happened."}</p><div className="place-prompt-actions"><button type="button" onClick={dismissPlacePrompt}>Not now</button><button type="button" onClick={() => { if (placePrompt.kind === "parking") { try { saveParkingSpot(vehicleId, placePrompt.fix); } catch { setError("Could not save this parking spot on this device."); } } else { try { savePlaceVisit(vehicleId, placePrompt); setPlaceVisits(readPlaceVisits(vehicleId)); } catch { setError("Could not save this visit on this device."); } } dismissPlacePrompt(); }}>{placePrompt.kind === "parking" ? "Save spot" : "Yes, save"}</button></div></section></div>}
  </div>;
}
