// 시나리오 B: 차 안 브리핑과 음성 질문. "어디에 넣어?"로 작업 세션에 연결한다.

import { useEffect, useState } from "react";
import { api, type MaintenanceRecord } from "../lib/api";
import { parseUtterance } from "../lib/commands";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";

const SOURCE_LABEL: Record<MaintenanceRecord["completion_source"], string> = {
  observed_sequence: "카메라 관찰",
  user_voice_confirmed: "음성 확인",
  manual_entry: "직접 입력",
};

export function Home({
  vehicleId,
  started,
  onStart,
  onStartTask,
}: {
  vehicleId: string;
  started: boolean;
  onStart: () => Promise<void>;
  onStartTask: () => void;
}) {
  const voice = useVoice();
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  useEffect(() => {
    api.memory(vehicleId).then(setRecords).catch(() => setRecords([]));
  }, [vehicleId]);

  const say = async (text: string) => {
    add("carmori", text);
    await voice.speak(text);
  };

  const begin = async () => {
    await onStart();
    const { text } = await api.briefing(vehicleId);
    await say(text);
  };

  useUtterances(async (text) => {
    add("me", text);
    const parsed = parseUtterance(text);
    if (parsed.kind === "start_task") {
      await say("휴대폰을 거치하고 투입구가 보이게 해주세요.");
      onStartTask();
      return;
    }
    const question = parsed.kind === "question" ? parsed.text : text;
    const answer = await api.ask(vehicleId, question);
    await say(answer.text);
    setRecords(await api.memory(vehicleId));
  });

  return (
    <div className="screen">
      <h1>Carmori</h1>
      {!started ? (
        <button className="primary" onClick={begin}>
          브리핑 시작
        </button>
      ) : (
        <p className="muted">듣고 있어요. "왜 확인해야 해?", "어디에 넣어?", "아까 뭐 했지?"</p>
      )}
      <Captions items={captions} />
      <section>
        <h2>차량 기억</h2>
        {records.length === 0 && <p className="muted">저장된 기록이 없어요.</p>}
        <ul className="records">
          {records.map((r) => (
            <li key={r.record_id}>
              {new Date(r.completed_at).toLocaleString()} · 워셔액 보충 · {SOURCE_LABEL[r.completion_source]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
