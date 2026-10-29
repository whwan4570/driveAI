import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "../components/Icons";
import { HistorySummary } from "../components/HistorySummary";
import { HistoryCalendar } from "../components/HistoryCalendar";
import { VehiclePhoto } from "../components/VehiclePhoto";
import { ServiceStatus } from "../components/ServiceStatus";
import { CarConnection, carConnectionAvailable, readCarBriefingSetting, saveCarBriefingSetting, type CarState } from "../lib/carConnection";
import { api, type CareResponse, type MaintenanceRecord, type MajorIssue, type Vehicle } from "../lib/api";
import { parseUtterance } from "../lib/commands";
import { DrivingGate } from "../lib/drivingGate";
import { DriveMetrics, type DriveFix, type DriveSummary } from "../lib/driveMetrics";
import { documentReminder, listDocuments, DOCUMENT_KINDS, type SavedDocument } from "../lib/documentVault";
import { MAINTENANCE_LABELS } from "../lib/serviceIntervals";
import { completeBrakeAnswer } from "../lib/manualAnswer";
import { SAMPLE_DRIVE_SUMMARY, sampleStatusCare } from "../lib/statusPreview";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";
import { Documents } from "./Documents";
import { RecordForm } from "./RecordForm";
import { Places } from "./Places";
import { TireInspection } from "./TireInspection";
import { VehicleEditor } from "./VehicleEditor";

type Tab = "home" | "status" | "places" | "assistant" | "guide" | "history" | "documents";
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

export function Home({ vehicleId, started, onStart, onStop, onStartTask }: {
  vehicleId: string;
  started: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onStartTask: () => Promise<void>;
}) {
  const voice = useVoice();
  const [tab, setTab] = useState<Tab>("home");
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuView, setMenuView] = useState<"menu" | "my-profile" | "settings">("menu");
  const menuPanelRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuCloseTimerRef = useRef<number | null>(null);
  const menuTouchXRef = useRef<number | null>(null);
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
  const [carBriefing, setCarBriefing] = useState(readCarBriefingSetting);
  const [autoMessage, setAutoMessage] = useState("Enable once before your drive");
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("Tracking is off");
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

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !menuPanelRef.current) return;
      const buttons = [...menuPanelRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, menuView]);

  useEffect(() => () => {
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
  }, []);

  const openMenu = () => {
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
    setNotificationsOpen(false);
    setMenuView("menu");
    setMenuMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setMenuOpen(true)));
  };

  const openSettings = () => {
    openMenu();
    setMenuView("settings");
  };

  const closeMenu = () => {
    setMenuOpen(false);
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuMounted(false);
      setMenuView("menu");
      menuCloseTimerRef.current = null;
    }, 240);
    menuButtonRef.current?.focus();
  };

  const say = async (text: string, sourceUrl?: string, sourceLabel?: string) => {
    add("carmori", text, sourceUrl, sourceLabel);
    lastSpokenRef.current = text;
    await voice.speak(text);
  };

  const goToTab = (next: Tab) => {
    setComposerMenuOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setMenuOpen(false);
    setMenuMounted(false);
    setMenuView("menu");
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

  const playBriefing = async (source: "manual" | "auto" | "car") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    setBriefingState("loading");
    if (source === "manual") voice.unlockTts();
    try {
      const { text } = await api.briefing(vehicleId);
      setBriefingState("speaking");
      if (source === "car") {
        // Native speech plays through CarPlay / Android Auto without a tap on the phone.
        add("carmori", text);
        lastSpokenRef.current = text;
        await CarConnection.speak({ text });
      } else {
        await say(text);
      }
      if (source === "manual") gateRef.current.markPlayed();
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

  // Play the briefing once each time the phone connects to CarPlay or Android Auto while Carmori is open.
  useEffect(() => {
    if (!carConnectionAvailable || !carBriefing) return;
    let cancelled = false;
    let playedThisConnection = false;
    const onState = (state: CarState) => {
      if (cancelled) return;
      if (!state.connected) { playedThisConnection = false; return; }
      if (playedThisConnection) return;
      playedThisConnection = true;
      void playBriefingRef.current("car");
    };
    const listener = CarConnection.addListener("carConnectionChange", onState);
    void CarConnection.getState().then(onState).catch(() => undefined);
    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, [carBriefing, vehicleId]);

  const startVoiceChat = async () => {
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
    if (saved) {
      manualTrackingRef.current = true;
      if (!startTracking()) manualTrackingRef.current = false;
    }
  }, [vehicleId]);

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
    goToTab("assistant");
    void submitQuestion("Which washer fluid fits today's weather? Have you checked current prices and reviews, or bought anything for me?");
  };

  const shownDriveSummary = samplePreview ? SAMPLE_DRIVE_SUMMARY : driveSummary;
  const shownStatusCare = samplePreview ? sampleStatusCare(care) : care;
  const weekHighway = shownDriveSummary.weekMeters ? Math.round((shownDriveSummary.weekHighwayMeters / shownDriveSummary.weekMeters) * 100) : null;
  const activeCareCount = care?.recommendations.filter((item) => item.priority !== "ROUTINE").length ?? 0;
  const statusReviewCount = shownStatusCare?.recommendations.filter((item) => item.priority !== "ROUTINE").length ?? 0;
  const notificationItems = (care?.recommendations.filter((item) => item.priority !== "ROUTINE") ?? [])
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
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
    { id: "places", label: "Places", icon: "pin" },
    { id: "home", label: "Home", icon: "home" },
    { id: "guide", label: "Guide", icon: "inspect" },
    { id: "history", label: "Glove box", icon: "file" },
  ];

  return <div className={`app-shell${keyboardOffset !== null ? " assistant-keyboard-open" : ""}`}>
    <main className={`screen home-screen${tab === "assistant" ? " assistant-screen" : ""}${(tab === "home" || tab === "status") && !profileOpen ? " is-k-home" : ""}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="car" size={27}/></span><span>Carmori</span></div>
        <div className="topbar-right">{(demoMode || vehicle?.profile_source === "demo") && <span className="demo-chip">{demoMode ? "Demo Mode" : "Sample vehicle"}</span>}<button className="topbar-alert" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications" aria-expanded={notificationsOpen} aria-controls="vehicle-notifications" title="Notifications"><Icon name="bell" size={20}/>{notificationItems.length + documentAlerts.length > 0 && <span className="topbar-alert-count">{notificationItems.length + documentAlerts.length}</span>}</button><button ref={menuButtonRef} className="profile-button" type="button" onClick={openMenu} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="carmori-side-menu" title="Menu"><Icon name="menu" size={22}/></button></div>
      </header>
      {samplePreview && <div className="sample-preview-banner" role="status"><span>Sample data preview · Your records are unchanged</span><button type="button" onClick={() => setPreview(false)}>Exit</button></div>}

      {notificationsOpen && <section className="notifications-panel" id="vehicle-notifications" aria-label="Vehicle notifications">
        <div className="notifications-heading"><div><strong>Notifications</strong></div><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="close" size={16}/></button></div>
        {(careLoading || documentsLoading) && <p className="notifications-empty">Checking saved records…</p>}
        {!careLoading && !documentsLoading && notificationItems.length + documentAlerts.length === 0 && <p className="notifications-empty">No items need your attention in saved records.</p>}
        {!careLoading && notificationItems.map((item) => <button className="notification-item" type="button" key={item.id} onClick={() => openNotification(item.component)}><span className={`notification-dot ${item.priority === "WARNING" ? "warning" : "caution"}`}/><span><strong>{item.title}</strong><small>{item.priority === "WARNING" ? "Warning" : item.priority === "CHECK_SOON" ? "Check soon" : "Needs information"}</small></span><Icon name="chevron" size={15}/></button>)}
        {documentAlerts.map(({ record, reminder }) => <button className="notification-item" type="button" key={`document-${record.kind}`} onClick={openDocuments}><span className={`notification-dot ${reminder.urgent ? "warning" : "caution"}`}/><span><strong>{DOCUMENT_KINDS.find((item) => item.kind === record.kind)?.label} renewal</strong><small>{reminder.label}</small></span><Icon name="chevron" size={15}/></button>)}
        <p className="notifications-footnote">Live dashboard alerts are not connected.</p>
      </section>}

      {profileOpen && vehicle && <VehicleEditor vehicle={vehicle} hasMajorIssues={majorIssues.length > 0} onSaved={(updated) => { setVehicle(updated); setProfileOpen(false); void refreshData(); }} onCancel={() => setProfileOpen(false)}/>}

      {!profileOpen && tab === "home" && <div className="k-home">
        <header className="k-hero">
          <p className="k-eyebrow">{vehicle?.nickname ? vehicleName(vehicle) : "Your car"}</p>
          <h1 className="k-title">{vehicle?.nickname || vehicleName(vehicle)}</h1>
          <p className="k-lead">{careLoading ? "Checking saved records…" : activeCareCount > 0 ? <><b>{activeCareCount} {activeCareCount === 1 ? "check" : "checks"}</b> before your next drive</> : "Nothing to review in your saved records"}</p>
        </header>
        <section className="k-block" aria-label="My vehicle">
          <div className="k-photo"><VehiclePhoto vehicle={vehicle}/></div>
          {vehicle?.image_status === "failed" && <div className="vehicle-image-error" role="status"><span>{vehicle.image_error || "Vehicle image unavailable."}</span><button type="button" onClick={() => void retryImage()} disabled={imageRetrying}>{imageRetrying ? "Trying…" : "Retry"}</button></div>}
          <div className="k-facts">
            <div><b>{vehicle?.odometer_km == null ? "—" : Math.round(vehicle.odometer_km / 1.609344).toLocaleString()}</b><span>{vehicle?.odometer_km == null ? "Odometer not set" : "Miles"}</span></div>
            <div><b>{miles(shownDriveSummary.weekMeters)}</b><span>This week</span></div>
            <div><b>{!samplePreview && care?.environment.status === "available" && care.environment.rainfall_mm !== null ? `${care.environment.rainfall_mm.toFixed(1)} mm` : "—"}</b><span>Rain, 7 days</span></div>
          </div>
        </section>
        {notificationItems.length > 0 && <section className="k-block is-list" aria-label="To review">
          <div className="k-block-head"><h2 className="k-h2">To review</h2><button className="k-block-link" type="button" onClick={() => goToTab("status")}>Status<Icon name="chevron" size={14}/></button></div>
          {notificationItems.map((item) => <button className="k-row" type="button" key={item.id} onClick={() => openNotification(item.component)}>
            <span className={`k-row-art ${item.component}`}><Icon name={item.component === "washer_fluid" ? "washer" : "status"} size={22}/></span>
            <span className="k-row-main"><span className={`k-badge ${PRIORITY_TONE[item.priority]}`}>{priorityLabel(item.priority)}</span><strong>{item.title}</strong><small>{item.last_recorded_at ? `Last recorded ${new Date(item.last_recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "No confirmed record yet"}</small></span>
            <Icon className="k-row-trail" name="chevron" size={18}/>
          </button>)}
        </section>}
        <section className="k-block is-list" aria-label="Briefing">
          <div className="k-block-head"><h2 className="k-h2">Briefing</h2></div>
          <div className="k-row">
            <span className="k-row-art briefing"><Icon name="volume" size={22}/></span>
            <span className="k-row-main"><strong>Hear briefing</strong><small aria-live="polite">{briefingState === "loading" ? "Preparing briefing…" : briefingState === "speaking" ? "Speaking now…" : briefingState === "idle" ? "From your saved records" : "Briefing played"}</small></span>
            <button className="k-btn small tint" type="button" onClick={() => void playBriefing("manual")} disabled={busy}>Play</button>
          </div>
        </section>
        {shownDriveSummary.weekMeters ? <section className="k-block" aria-label="Driving insights">
          <h2 className="k-h2">Driving insights</h2>
          <div className="k-facts">
            <div><b>{weekHighway === null ? "—" : `${weekHighway}%`}</b><span>Highway</span></div>
            <div><b>{weekHighway === null ? "—" : `${100 - weekHighway}%`}</b><span>City</span></div>
            <div><b>{samplePreview ? 6 : driveSummary.weekTrackedDays}</b><span>{samplePreview ? "Sample days" : "Tracked days"}</span></div>
          </div>
        </section> : null}
      </div>}

      {!profileOpen && tab === "status" && <div className="k-home k-status">
        <header className="k-hero">
          <p className="k-eyebrow">{vehicle?.nickname || vehicleName(vehicle)}{vehicle?.odometer_km == null ? "" : ` · ${Math.round(vehicle.odometer_km / 1.609344).toLocaleString()} mi`}</p>
          <h1 className="k-title">Status</h1>
          <p className="k-lead">{careLoading ? "Checking saved records…" : statusReviewCount > 0 ? <><b>{statusReviewCount} {statusReviewCount === 1 ? "item" : "items"}</b> to review</> : "Nothing flagged in your saved records"}</p>
        </header>
        <Suspense fallback={<div className="status-3d-loading">Loading vehicle view…</div>}><StatusVehicle3D vehicle={vehicle} care={shownStatusCare} loading={careLoading} samplePreview={samplePreview} showHeader={false}/></Suspense>
        <ServiceStatus vehicle={vehicle} records={records} care={shownStatusCare} loading={memoryLoading || careLoading} onSaved={refreshData} onTireInspection={() => openRecord("tires")} onWasherGuide={() => void beginTask()} guideBusy={busy} samplePreview={samplePreview}/>
        <section className="k-block" aria-label="Mileage">
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
        </section>
      </div>}

      {!profileOpen && tab === "places" && <Places key={vehicleId} vehicleId={vehicleId} care={care} onAskMuse={askMuseToShop}/>}

      {!profileOpen && tab === "assistant" && <>
        <Captions items={captions}/>
        <form ref={composerRef} className="assistant-compose" style={keyboardOffset !== null ? { bottom: `${keyboardOffset + 8}px` } : undefined} onSubmit={(event) => void askTypedQuestion(event)}>
          <button className="assistant-plus" type="button" onClick={() => setComposerMenuOpen((open) => !open)} aria-label="More actions" aria-expanded={composerMenuOpen} aria-controls="assistant-composer-menu"><Icon name="plus" size={20}/></button>
          <input ref={composerInputRef} aria-label="Ask Carmori a question" placeholder="Ask about your car…" value={typedQuestion} onChange={(event) => setTypedQuestion(event.target.value)} onFocus={() => { setComposerFocused(true); setComposerMenuOpen(false); if (started) void onStop(); }} onBlur={() => setComposerFocused(false)} maxLength={500}/>
          {typedQuestion.trim() ? <button className="assistant-send" type="submit" disabled={asking} aria-label="Send question">{asking ? "…" : "Ask"}</button> : !composerFocused && <button className={`assistant-mic${started ? " is-listening" : ""}`} type="button" onClick={() => void (started ? onStop() : startVoiceChat())} disabled={busy} aria-label={started ? "Stop listening" : "Start voice chat"} aria-pressed={started}><Icon name={started ? "pause" : "mic"} size={22}/></button>}
          {composerMenuOpen && <div className="assistant-composer-menu" id="assistant-composer-menu"><button type="button" onClick={() => { setComposerMenuOpen(false); goToTab("guide"); }}><Icon name="camera" size={18}/>Camera guide</button><button type="button" onClick={() => { setComposerMenuOpen(false); openDocuments(); }}><Icon name="file" size={18}/>Add document</button></div>}
        </form>
      </>}

      {!profileOpen && tab === "guide" && <>
        {!tireOpen && <div className="guide-list"><section className="guide-option"><span className="guide-option-icon"><Icon name="inspect" size={22}/></span><div><h2>Washer fluid</h2><p>Locate the inlet, check the product, and follow hands-free steps.</p></div><button type="button" onClick={() => void beginTask()} disabled={busy}>Start washer guide <Icon name="arrow" size={17}/></button></section><section className="guide-option"><span className="guide-option-icon"><Icon name="status" size={22}/></span><div><h2>Tire visual check</h2><p>Photograph a tire and add gauge measurements if you have them.</p></div><button type="button" onClick={() => setTireOpen(true)}>Inspect tire <Icon name="arrow" size={17}/></button></section></div>}
        {tireOpen && vehicle && <TireInspection vehicle={vehicle} onSaved={() => { setTireOpen(false); void refreshData(); goToTab("history"); }} onCancel={() => setTireOpen(false)}/>}
      </>}

      {!profileOpen && tab === "history" && <>
        <HistorySummary vehicle={vehicle} issues={majorIssues} issuesLoading={issuesLoading} issuesAvailable={issuesAvailable} onEditVehicle={() => setProfileOpen(true)} onVehicleUpdated={setVehicle} onRefresh={refreshData}/>
        <button className="documents-shortcut" type="button" onClick={openDocuments}><span className="documents-shortcut-icon"><Icon name="file" size={21}/></span><span><strong>Driving documents</strong><small>{documentsError ? "Local storage unavailable" : documentsLoading ? "Checking this device…" : `${savedDocumentCount} of 3 saved offline${documentAlerts[0] ? ` · ${DOCUMENT_KINDS.find((item) => item.kind === documentAlerts[0].record.kind)?.shortLabel} ${documentAlerts[0].reminder.label.toLowerCase()}` : ""}`}</small></span><Icon name="chevron" size={18}/></button>
        {recordOpen && vehicle && <RecordForm key={recordComponent} vehicle={vehicle} initialComponent={recordComponent} onSaved={() => { setRecordOpen(false); void refreshData(); }} onCancel={() => setRecordOpen(false)}/>}
        <section className="history-panel"><div className="history-title"><span className="history-title-icon"><Icon name="history" size={22}/></span><div><h2>History</h2><p>{records.length} confirmed {records.length === 1 ? "record" : "records"}</p></div></div>
          <button className="history-add-button" type="button" onClick={() => { setRecordComponent("washer_fluid"); setRecordOpen(true); }}>Add completed work <Icon name="arrow" size={16}/></button>
          <div className="history-view-switch" role="group" aria-label="History view"><button type="button" className={historyView === "list" ? "selected" : ""} onClick={() => setHistoryView("list")}>List</button><button type="button" className={historyView === "calendar" ? "selected" : ""} onClick={() => setHistoryView("calendar")}>Calendar</button></div>
          {historyView === "calendar" ? <HistoryCalendar records={records} issues={issuesAvailable ? majorIssues : []}/> : <>
            {records.length === 0 && <div className="empty-state"><Icon name="history" size={30}/><strong>No records yet</strong><p>Only completed work you confirm will be saved here.</p></div>}
            {records.map((record) => <div className="history-record" key={record.record_id}><button className="history-item" type="button" onClick={() => setOpenRecordId(openRecordId === record.record_id ? null : record.record_id)} aria-expanded={openRecordId === record.record_id}><span className="history-item-dot"><Icon name="check" size={14}/></span><div><strong>{MAINTENANCE_LABELS[record.component] || record.component} {record.event_type}</strong><p>{new Date(record.completed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{record.odometer_km !== null ? ` · ${Math.round(record.odometer_km / 1.609344).toLocaleString()} mi` : ""}</p><span>{SOURCE_LABEL[record.completion_source]}{record.product_label ? ` · ${record.product_label}` : ""}</span></div>{record.photo_data_url && <img className="history-thumb" src={record.photo_data_url} alt="Saved maintenance"/>}<Icon name="chevron" size={16}/></button>{openRecordId === record.record_id && <div className="history-detail"><p>{record.notes || "No notes added."}</p>{record.photo_data_url && <img className="history-photo" src={record.photo_data_url} alt="Maintenance photo"/>}<small>Completion: {SOURCE_LABEL[record.completion_source]}{record.flow_observed ? " · Pour observed by camera" : ""}</small></div>}</div>)}
          </>}
        </section>
      </>}

      {!profileOpen && tab === "documents" && <Documents vehicleId={vehicleId} records={documents.filter((record) => record.vehicleId === vehicleId)} storageError={documentsError} onChanged={refreshDocuments} onBack={() => goToTab(documentReturnTabRef.current)}/>}

      {error && tab !== "documents" && <div className="inline-error" role="alert">{error}</div>}
    </main>
    {!profileOpen && tab !== "assistant" && tab !== "documents" && <button className={`floating-mic${fabHidden ? " is-hidden" : ""}`} type="button" onClick={() => void startVoiceChat()} disabled={busy} aria-label="Ask by voice" aria-hidden={fabHidden} tabIndex={fabHidden ? -1 : 0} title="Ask by voice"><Icon name="mic" size={25}/></button>}
    <nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav-inner">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id || (tab === "documents" && item.id === "history") ? "active" : ""} onClick={() => goToTab(item.id)} disabled={busy}><Icon name={item.icon} size={23}/><span>{item.label}</span></button>)}</div></nav>
    {menuMounted && <>
      <div className={`side-menu-backdrop${menuOpen ? " is-open" : ""}`} onClick={closeMenu} aria-hidden="true"/>
      <aside ref={menuPanelRef} className={`side-menu${menuOpen ? " is-open" : ""}`} id="carmori-side-menu" role="dialog" aria-modal="true" aria-hidden={!menuOpen} aria-label={menuView === "menu" ? "Menu" : menuView === "my-profile" ? "My profile" : "Settings"} onTouchStart={(event) => { menuTouchXRef.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (menuTouchXRef.current !== null && event.changedTouches[0]?.clientX - menuTouchXRef.current > 70) closeMenu(); menuTouchXRef.current = null; }}>
        <div className="side-menu-header"><span>{menuView === "menu" ? "Carmori" : menuView === "my-profile" ? "My profile" : "Settings"}</span><button type="button" onClick={closeMenu} aria-label="Close menu"><Icon name="close" size={20}/></button></div>
        {menuView === "menu" ? <>
          <button className="side-menu-identity" type="button" onClick={() => setMenuView("my-profile")}><span className="side-menu-avatar"><Icon name="profile" size={25}/></span><span><strong>My profile</strong><small>Local prototype</small></span></button>
          <nav className="side-menu-links" aria-label="Profile menu">
            <button type="button" onClick={() => { closeMenu(); setProfileOpen(true); }}><Icon name="car" size={22}/><span>Car profile</span><Icon name="chevron" size={17}/></button>
          </nav>
          <div className="side-menu-footer"><button type="button" onClick={() => setMenuView("settings")}><Icon name="settings" size={22}/><span>Settings</span><Icon name="chevron" size={17}/></button></div>
        </> : <>
          <button className="side-menu-back" type="button" onClick={() => setMenuView("menu")}>‹ Menu</button>
          {menuView === "my-profile" ? <p className="side-menu-note">Personal profile is not set up in this prototype.</p> : <div className="side-menu-settings">
            <strong>Sample data preview</strong>
            <p>Review driving and service indicators without changing saved records.</p>
            <button className="side-menu-track sample-preview-toggle" type="button" onClick={() => setPreview(!samplePreview)}>{samplePreview ? "Exit sample preview" : "Preview sample data"}</button>
            <div className="side-menu-settings-divider"/>
            <strong>Drive tracking</strong>
            <p>Resumes when you reopen the app. Uses phone location while this page is open.</p>
            <button className={`side-menu-track${trackingEnabled ? " is-tracking" : ""}`} type="button" onClick={toggleStatusTracking}><Icon name={trackingEnabled ? "pause" : "status"} size={19}/>{trackingEnabled ? "Stop drive tracking" : "Start drive tracking"}</button>
            <p className="side-menu-track-status" role="status"><span className={trackingEnabled ? "status-tracking-dot active" : "status-tracking-dot"}/>{trackingMessage}</p>
            <div className="side-menu-settings-divider"/>
            <strong>Play briefing when driving</strong>
            <p>Plays your briefing once driving movement is detected. Also records your drives with phone location while this page is open.</p>
            <button className={`side-menu-track${autoEnabled ? " is-tracking" : ""}`} type="button" role="switch" aria-checked={autoEnabled} onClick={toggleAutoBriefing}><Icon name={autoEnabled ? "pause" : "volume"} size={19}/>{autoEnabled ? "Turn off auto briefing" : "Turn on auto briefing"}</button>
            {autoEnabled && <p className="side-menu-track-status" role="status"><span className="status-tracking-dot active"/>{autoMessage}</p>}
            {carConnectionAvailable && <>
              <div className="side-menu-settings-divider"/>
              <strong>Play briefing when car connects</strong>
              <p>Plays through CarPlay or Android Auto when Carmori is open as your phone connects.</p>
              <button className={`side-menu-track${carBriefing ? " is-tracking" : ""}`} type="button" role="switch" aria-checked={carBriefing} onClick={() => { saveCarBriefingSetting(!carBriefing); setCarBriefing(!carBriefing); }}><Icon name={carBriefing ? "pause" : "car"} size={19}/>{carBriefing ? "Turn off car briefing" : "Turn on car briefing"}</button>
            </>}
          </div>}
        </>}
      </aside>
    </>}
  </div>;
}
