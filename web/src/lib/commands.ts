// 인식된 문장을 세션 명령으로 바꾼다. 작업 중 명령은 빨라야 하므로 키워드 규칙을 먼저 쓰고,
// 어디에도 걸리지 않으면 질문으로 넘긴다.

import type { VoiceIntent } from "./api";

export type ParsedUtterance =
  | { kind: "session"; intent: VoiceIntent }
  | { kind: "start_task" }
  | { kind: "question"; text: string }
  | { kind: "empty" };

// 순서가 중요하다: "다시 시작"은 "다시"보다, "안 했어"는 "했어"보다 먼저 본다.
const RULES: [RegExp, VoiceIntent][] = [
  [/다시\s*시작|처음부터/, "RESTART"],
  [/다시\s*(설명|말해)|뭐라고|한\s*번\s*더/, "REPEAT"],
  [/기록\s*(수정|고쳐)/, "EDIT_RECORD"],
  [/잠깐|멈춰|스톱|정지/, "PAUSE"],
  [/계속/, "RESUME"],
  [/아니|안\s*했|아직/, "CONFIRM_NO"],
  [/^(네|예|응|맞아|했어|마쳤어|다\s*했어|보충했어)/, "CONFIRM_YES"],
];

const START_TASK = /어디에?\s*넣|보충\s*(할래|하자|시작)|넣는\s*법/;

export function parseUtterance(raw: string): ParsedUtterance {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  if (START_TASK.test(text)) return { kind: "start_task" };
  for (const [pattern, intent] of RULES) {
    if (pattern.test(text)) return { kind: "session", intent };
  }
  return { kind: "question", text };
}
