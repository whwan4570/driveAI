// Make → model picker. Choosing a make opens its model list; both allow typing a name that is not listed.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { Icon } from "./Icons";

type Sheet = "make" | "model" | null;
type ModelList = { models: string[]; status: "loading" | "available" | "unavailable" };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// The picker sits inside vehicle forms: Enter in its fields must not submit them.
const holdEnter = (event: KeyboardEvent<HTMLInputElement>, then?: () => void) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  then?.();
};

export function VehiclePicker({ make, model, year, onChange }: {
  make: string;
  model: string;
  year: number | null;
  onChange: (next: { make: string; model: string }) => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [makes, setMakes] = useState<{ makes: string[]; popular: string[] } | null>(null);
  const [modelList, setModelList] = useState<ModelList>({ models: [], status: "loading" });
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const cache = useRef(new Map<string, ModelList>());

  useEffect(() => {
    if (sheet !== "make" || makes) return;
    api.vehicleMakes().then(setMakes).catch(() => setMakes({ makes: [], popular: [] }));
  }, [sheet, makes]);

  useEffect(() => {
    if (sheet !== "model" || !make) return;
    const key = `${make.toLowerCase()}|${year ?? ""}`;
    const cached = cache.current.get(key);
    if (cached) { setModelList(cached); return; }
    let active = true;
    setModelList({ models: [], status: "loading" });
    api.vehicleModels(make, year)
      .then((result) => {
        const list: ModelList = { models: result.models, status: result.status };
        if (result.status === "available") cache.current.set(key, list);
        if (active) setModelList(list);
      })
      .catch(() => { if (active) setModelList({ models: [], status: "unavailable" }); });
    return () => { active = false; };
  }, [sheet, make, year]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setSheet(null); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); };
  }, [sheet]);

  const open = (next: Sheet) => { setQuery(""); setTyping(false); setTyped(""); setSheet(next); };

  const chooseMake = (name: string) => {
    const value = name.trim();
    if (!value) return;
    onChange({ make: value, model: sameName(value, make) ? model : "" });
    open("model");
  };

  const chooseModel = (name: string) => {
    const value = name.trim();
    if (!value) return;
    onChange({ make, model: value });
    setSheet(null);
  };

  const search = query.trim().toLowerCase();
  const matches = (name: string) => !search || name.toLowerCase().includes(search);
  const makeOptions = makes?.makes.filter(matches) ?? [];
  const modelOptions = modelList.models.filter(matches);
  const manualOnly = sheet === "model" && modelList.status === "unavailable";
  const submitTyped = () => { if (sheet === "make") chooseMake(typed); else chooseModel(typed); };

  return <>
    <div className="review-fields">
      <div className="picker-field"><span>Make</span><button type="button" className={`picker-button${make ? "" : " empty"}`} onClick={() => open("make")} aria-haspopup="dialog"><span>{make || "Choose make"}</span><Icon name="chevron" size={16}/></button></div>
      <div className="picker-field"><span>Model</span><button type="button" className={`picker-button${model ? "" : " empty"}`} onClick={() => open(make ? "model" : "make")} aria-haspopup="dialog"><span>{model || (make ? "Choose model" : "Choose make first")}</span><Icon name="chevron" size={16}/></button></div>
    </div>

    {sheet && createPortal(<div className="picker-backdrop" onClick={() => setSheet(null)}>
      <div className="picker-sheet" role="dialog" aria-modal="true" aria-label={sheet === "make" ? "Choose make" : `Choose ${make} model`} onClick={(event) => event.stopPropagation()}>
        <div className="picker-header">
          {sheet === "model" ? <button type="button" className="picker-back" onClick={() => open("make")} aria-label="Back to makes"><Icon name="chevron" size={20}/></button> : <span/>}
          <div><strong>{sheet === "make" ? "Choose make" : `${make} models`}</strong>{sheet === "model" && <small>{year ? `${year} model year` : "All years · add the model year to narrow this list"}</small>}</div>
          <button type="button" className="picker-close" onClick={() => setSheet(null)} aria-label="Close"><Icon name="close" size={20}/></button>
        </div>

        {!manualOnly && <input className="picker-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => holdEnter(event)} placeholder={sheet === "make" ? "Search makes" : "Search models"} aria-label={sheet === "make" ? "Search makes" : "Search models"}/>}

        <div className="picker-body">
          {sheet === "make" && <>
            {!makes && <p className="picker-note">Loading makes…</p>}
            {makes && !search && makes.popular.length > 0 && <div className="picker-chips" role="group" aria-label="Popular makes">{makes.popular.map((name) => <button type="button" key={name} className={sameName(name, make) ? "selected" : ""} onClick={() => chooseMake(name)}>{name}</button>)}</div>}
            {makes && <ul className="picker-list">{makeOptions.map((name) => <li key={name}><button type="button" className={sameName(name, make) ? "selected" : ""} onClick={() => chooseMake(name)}>{name}{sameName(name, make) && <Icon name="check" size={17}/>}</button></li>)}</ul>}
            {makes && makeOptions.length === 0 && <p className="picker-note">No matching make.</p>}
          </>}

          {sheet === "model" && <>
            {modelList.status === "loading" && <p className="picker-note">Loading {make} models…</p>}
            {manualOnly && <p className="picker-note">The model list is unavailable right now. Enter your model below.</p>}
            {modelList.status === "available" && <ul className="picker-list">{modelOptions.map((name) => <li key={name}><button type="button" className={sameName(name, model) ? "selected" : ""} onClick={() => chooseModel(name)}>{name}{sameName(name, model) && <Icon name="check" size={17}/>}</button></li>)}</ul>}
            {modelList.status === "available" && modelOptions.length === 0 && <p className="picker-note">No matching model.</p>}
          </>}

          {(typing || manualOnly) ? <div className="picker-manual">
            <input value={typed} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => holdEnter(event, submitTyped)} maxLength={60} placeholder={sheet === "make" ? "Enter make" : "Enter model"} aria-label={sheet === "make" ? "Enter make" : "Enter model"} autoFocus/>
            <button type="button" className="primary" onClick={submitTyped} disabled={!typed.trim()}>Use</button>
          </div> : <button type="button" className="picker-other" onClick={() => { setTyping(true); setTyped(query); }}>{sheet === "make" ? "My make isn't listed" : "My model isn't listed"}<Icon name="chevron" size={15}/></button>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
