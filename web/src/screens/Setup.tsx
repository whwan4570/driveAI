import { useEffect, useState, type FormEvent } from "react";
import { api, type VehicleSpecView } from "../lib/api";

export function Setup({ onRegistered }: { onRegistered: (vehicleId: string) => void }) {
  const [specs, setSpecs] = useState<VehicleSpecView[]>([]);
  const [specId, setSpecId] = useState("");
  const [year, setYear] = useState(2021);
  const [lastRefill, setLastRefill] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vehicleSpecs()
      .then((list) => {
        setSpecs(list);
        if (list[0]) setSpecId(list[0].spec_id);
      })
      .catch(() => setError("서버에 연결하지 못했어요."));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const vehicle = await api.createVehicle({
        spec_id: specId,
        year,
        last_refill_at: lastRefill ? new Date(lastRefill).toISOString() : undefined,
      });
      onRegistered(vehicle.vehicle_id);
    } catch {
      setError("지원하지 않는 차량이거나 저장에 실패했어요.");
    }
  };

  return (
    <form className="screen" onSubmit={submit}>
      <h1>차량 등록</h1>
      <label>
        차종
        <select value={specId} onChange={(e) => setSpecId(e.target.value)}>
          {specs.map((s) => (
            <option key={s.spec_id} value={s.spec_id}>
              {s.display_name} ({s.years[0]}–{s.years[1]})
            </option>
          ))}
        </select>
      </label>
      <label>
        연식
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </label>
      <label>
        마지막 워셔액 보충일 (모르면 비워두기)
        <input type="date" value={lastRefill} onChange={(e) => setLastRefill(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={!specId}>
        저장
      </button>
    </form>
  );
}
