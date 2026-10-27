// Route short spoken commands before sending open questions to the assistant.

import type { VoiceIntent } from "./api";

export type ParsedUtterance =
  | { kind: "session"; intent: VoiceIntent }
  | { kind: "start_task" }
  | { kind: "question"; text: string }
  | { kind: "empty" };

// Order matters: restart before repeat, and negative confirmations before yes.
const RULES: [RegExp, VoiceIntent][] = [
  [/\b(restart|start over|from the beginning)\b/i, "RESTART"],
  [/\b(repeat|say that again|tell me again|what did you say|one more time)\b/i, "REPEAT"],
  [/\b(edit|correct|change) (the |my )?(record|entry)\b/i, "EDIT_RECORD"],
  [/\b(pause|hold on|wait a second|stop for a moment)\b/i, "PAUSE"],
  [/\b(resume|continue|go on|keep going)\b/i, "RESUME"],
  [/^(no|nope|not yet|i (have not|haven't|did not|didn't)|i'm not done)\b/i, "CONFIRM_NO"],
  [/^(yes|yeah|yep|i (did|have|finished|completed|refilled)|done|finished|completed)\b/i, "CONFIRM_YES"],
];

const START_TASK = /\b(where (do|should) i (put|pour|add) (the )?washer fluid|how do i (add|refill) washer fluid|start (the )?(washer fluid )?(refill|check|guide)|help me refill|let's refill)\b/i;

export function parseUtterance(raw: string): ParsedUtterance {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  if (START_TASK.test(text)) return { kind: "start_task" };
  for (const [pattern, intent] of RULES) {
    if (pattern.test(text)) return { kind: "session", intent };
  }
  return { kind: "question", text };
}
