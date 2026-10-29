import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import {
  DOCUMENT_KINDS, documentReminder, downloadRenewalReminder, removeDocument, saveDocument,
  type DocumentKind, type SavedDocument,
} from "../lib/documentVault";
import { formatVehicleDate } from "../lib/vehicleDates";

const MAX_FILE_BYTES = 8_000_000;

export function Documents({ vehicleId, records, storageError, onChanged, onBack }: {
  vehicleId: string;
  records: SavedDocument[];
  storageError: string | null;
  onChanged: () => Promise<void>;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<DocumentKind | null>(null);
  const [viewing, setViewing] = useState<DocumentKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expiresOn, setExpiresOn] = useState("");
  const [remindDays, setRemindDays] = useState<7 | 30 | 60>(30);
  const [file, setFile] = useState<File | null>(null);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = editing ? records.find((item) => item.kind === editing) : null;
  const viewed = viewing ? records.find((item) => item.kind === viewing) : null;

  useEffect(() => {
    if (!viewed?.file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(viewed.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [viewed?.file]);

  const beginEdit = (kind: DocumentKind) => {
    const saved = records.find((item) => item.kind === kind);
    setEditing(kind);
    setViewing(null);
    setExpiresOn(saved?.expiresOn ?? "");
    setRemindDays(saved?.remindDays ?? 30);
    setFile(null);
    setRemoveExistingFile(false);
    setError(null);
  };

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(next.type)) {
      setError("Choose a JPEG, PNG, WebP, or PDF file."); return;
    }
    if (next.size > MAX_FILE_BYTES) { setError("Choose a file smaller than 8 MB."); return; }
    setFile(next);
    setRemoveExistingFile(false);
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    if (!expiresOn && !file && (!selected?.file || removeExistingFile)) {
      setError("Add an expiration date or a document copy."); return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveDocument({
        id: `${vehicleId}:${editing}`, vehicleId, kind: editing,
        expiresOn: expiresOn || null, remindDays,
        fileName: file?.name ?? (removeExistingFile ? null : selected?.fileName ?? null),
        mimeType: file?.type ?? (removeExistingFile ? null : selected?.mimeType ?? null),
        file: file ?? (removeExistingFile ? null : selected?.file ?? null),
        updatedAt: new Date().toISOString(),
      });
      await onChanged();
      setEditing(null);
      setFile(null);
    } catch {
      setError("Could not save on this device. Check browser storage and try again.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || busy || !window.confirm("Remove this saved copy and renewal date from this device?")) return;
    setBusy(true);
    setError(null);
    try {
      await removeDocument(vehicleId, editing);
      await onChanged();
      setEditing(null);
    } catch { setError("Could not remove this document."); }
    finally { setBusy(false); }
  };

  const view = (kind: DocumentKind) => {
    const saved = records.find((item) => item.kind === kind);
    if (!saved?.file) { beginEdit(kind); return; }
    setEditing(null);
    setViewing(kind);
  };

  return <div className="documents-screen">
    <div className="documents-heading"><button type="button" onClick={onBack} aria-label="Back to previous screen">←</button><div><span className="eyebrow">IN YOUR GLOVEBOX</span><h1>Documents</h1></div></div>
    <section className="document-access" aria-label="Quick access to driving documents">
      <div><Icon name="file" size={20}/><strong>Quick access</strong></div>
      <p>Open the requested document when stopped. Keep originals where your location requires them.</p>
      <div className="document-access-buttons">{DOCUMENT_KINDS.filter((item) => item.kind !== "sticker").map((item) => {
        const saved = records.find((record) => record.kind === item.kind);
        return <button type="button" key={item.kind} onClick={() => view(item.kind)}><span>{item.shortLabel}</span><small>{saved?.file ? "View copy" : "Add copy"}</small></button>;
      })}</div>
    </section>

    {storageError && <p className="inline-error" role="alert">{storageError}</p>}
    <div className="document-list">{DOCUMENT_KINDS.map((item) => {
      const saved = records.find((record) => record.kind === item.kind);
      const reminder = saved ? documentReminder(saved) : null;
      return <section className="document-card" key={item.kind}>
        <div className="document-card-top"><span className="document-card-icon"><Icon name={item.kind === "insurance" ? "shield" : item.kind === "sticker" ? "calendar" : "file"} size={20}/></span><div><h2>{item.label}</h2><p>{saved?.expiresOn ? `Renews ${formatVehicleDate(saved.expiresOn)}` : "Add renewal date"} · {saved?.file ? "Saved offline" : "No offline copy"}</p></div>{reminder && <span className={`document-due${reminder.urgent ? " urgent" : ""}`}>{reminder.label}</span>}</div>
        <div className="document-card-actions"><button type="button" onClick={() => view(item.kind)}>{saved?.file ? "View copy" : "Add copy"}</button><button type="button" onClick={() => beginEdit(item.kind)}>{saved ? "Edit" : "Set reminder"}</button>{saved?.expiresOn && <button type="button" onClick={() => downloadRenewalReminder(saved)}>Add to calendar</button>}</div>
      </section>;
    })}</div>
    <p className="documents-privacy">Saved only in this browser, with no upload or AI processing. Available offline after the app has loaded once. Clearing browser data removes copies. Add to calendar for alerts while the app is closed.</p>

    {editing && <div className="document-modal-backdrop" role="presentation"><section className="document-modal" role="dialog" aria-modal="true" aria-label={`Edit ${DOCUMENT_KINDS.find((item) => item.kind === editing)?.label}`}>
      <div className="document-modal-top"><h2>{DOCUMENT_KINDS.find((item) => item.kind === editing)?.label}</h2><button type="button" onClick={() => setEditing(null)} aria-label="Close"><Icon name="close" size={18}/></button></div>
      <form onSubmit={(event) => void save(event)}>
        <label>Expiration or renewal date<input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)}/></label>
        <label>Remind me<select value={remindDays} onChange={(event) => setRemindDays(Number(event.target.value) as 7 | 30 | 60)}><option value={7}>7 days before</option><option value={30}>30 days before</option><option value={60}>60 days before</option></select></label>
        <div className="document-file-choices"><label><Icon name="camera" size={17}/>Take photo<input type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])}/></label><label><Icon name="file" size={17}/>Choose file<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => chooseFile(event.target.files?.[0])}/></label></div>
        {(file || (selected?.file && !removeExistingFile)) && <div className="document-file-selected"><span>{file?.name ?? selected?.fileName ?? "Saved copy"}</span><button type="button" onClick={() => { setFile(null); setRemoveExistingFile(true); }}>Remove copy</button></div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="document-save" type="submit" disabled={busy}>{busy ? "Saving…" : "Save on this device"}</button>
        {selected && <button className="document-remove" type="button" onClick={() => void remove()} disabled={busy}>Remove document and date</button>}
      </form>
    </section></div>}

    {viewing && <div className="document-modal-backdrop" role="presentation"><section className="document-viewer" role="dialog" aria-modal="true" aria-label={`${DOCUMENT_KINDS.find((item) => item.kind === viewing)?.label} copy`}>
      <div className="document-modal-top"><h2>{DOCUMENT_KINDS.find((item) => item.kind === viewing)?.label}</h2><button type="button" onClick={() => setViewing(null)} aria-label="Close"><Icon name="close" size={20}/></button></div>
      {previewUrl && viewed?.mimeType === "application/pdf" && <iframe src={previewUrl} title="Saved document PDF"/>}
      {previewUrl && viewed?.mimeType?.startsWith("image/") && <img src={previewUrl} alt={`Saved ${DOCUMENT_KINDS.find((item) => item.kind === viewing)?.label}`}/>}
      {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer">Open full size</a>}
      <p>Saved locally · {viewed?.expiresOn ? `Renewal ${formatVehicleDate(viewed.expiresOn)}` : "Renewal date not set"}</p>
    </section></div>}
  </div>;
}
