import { todayLocalISO } from "./vehicleDates";

export type DocumentKind = "license" | "registration" | "insurance" | "sticker";

export const DOCUMENT_KINDS: { kind: DocumentKind; label: string; shortLabel: string }[] = [
  { kind: "license", label: "Driver license", shortLabel: "License" },
  { kind: "registration", label: "Vehicle registration", shortLabel: "Registration" },
  { kind: "insurance", label: "Insurance card", shortLabel: "Insurance" },
  { kind: "sticker", label: "Registration sticker", shortLabel: "Sticker" },
];

export type SavedDocument = {
  id: string;
  vehicleId: string;
  kind: DocumentKind;
  expiresOn: string | null;
  remindDays: 7 | 30 | 60;
  fileName: string | null;
  mimeType: string | null;
  file: Blob | null;
  updatedAt: string;
};

const DB_NAME = "carmori-private-documents";
const STORE_NAME = "documents";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("Local document storage is unavailable")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local document storage"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed"));
  });
}

function writeTransaction(db: IDBDatabase, write: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage write failed"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage write failed"));
    write(transaction.objectStore(STORE_NAME));
  });
}

export async function listDocuments(vehicleId: string): Promise<SavedDocument[]> {
  const db = await openDatabase();
  try {
    const records = await requestResult(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll() as IDBRequest<SavedDocument[]>);
    return records.filter((record) => record.vehicleId === vehicleId);
  } finally { db.close(); }
}

export async function saveDocument(record: SavedDocument): Promise<void> {
  const db = await openDatabase();
  try {
    await writeTransaction(db, (store) => { store.put(record); });
    try { await navigator.storage?.persist?.(); } catch { /* Browser may decline persistent storage. */ }
  } finally { db.close(); }
}

export async function removeDocument(vehicleId: string, kind: DocumentKind): Promise<void> {
  const db = await openDatabase();
  try {
    await writeTransaction(db, (store) => { store.delete(`${vehicleId}:${kind}`); });
  } finally { db.close(); }
}

export function daysUntil(isoDate: string | null): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  if (new Date(target).toISOString().slice(0, 10) !== isoDate) return null;
  const [todayYear, todayMonth, todayDay] = todayLocalISO().split("-").map(Number);
  return Math.round((target - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000);
}

export function documentReminder(record: SavedDocument): { days: number; label: string; urgent: boolean } | null {
  const days = daysUntil(record.expiresOn);
  if (days === null || days > record.remindDays) return null;
  if (days < 0) return { days, label: `Expired ${Math.abs(days)} days ago`, urgent: true };
  if (days === 0) return { days, label: "Expires today", urgent: true };
  return { days, label: `Expires in ${days} ${days === 1 ? "day" : "days"}`, urgent: days <= 7 };
}

function escapeCalendarText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function downloadRenewalReminder(record: SavedDocument): void {
  if (!record.expiresOn) return;
  const label = DOCUMENT_KINDS.find((item) => item.kind === record.kind)?.label ?? "Driving document";
  const event = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Carmori//Renewal Reminder//EN", "BEGIN:VEVENT",
    `UID:carmori-${record.id.replace(/[^a-zA-Z0-9-]/g, "-")}-${record.expiresOn}@local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
    `DTSTART;VALUE=DATE:${record.expiresOn.replace(/-/g, "")}`,
    `SUMMARY:${escapeCalendarText(`Renew ${label}`)}`,
    `DESCRIPTION:${escapeCalendarText("Check the issuing agency or insurer for renewal details.")}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:-P${record.remindDays}D`, `DESCRIPTION:${escapeCalendarText(`Renew ${label}`)}`, "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P7D", `DESCRIPTION:${escapeCalendarText(`Renew ${label}`)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([event], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `carmori-${record.kind}-renewal.ics`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
