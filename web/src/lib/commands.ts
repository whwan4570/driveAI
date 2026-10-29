// Route short spoken commands before sending open questions to the assistant.

import type { VoiceIntent } from "./api";

export type ParsedUtterance =
  | { kind: "session"; intent: VoiceIntent }
  | { kind: "start_task" }
  | { kind: "question"; text: string }
  | { kind: "empty" };

// Order matters: restart before repeat, and negative confirmations before yes.
const RULES: [RegExp, VoiceIntent][] = [
  [/^(?:please )?(?:restart|start over|from the beginning)(?: the guide)?[.!?]?$/i, "RESTART"],
  [/^(?:please )?(?:repeat(?: that| the last step)?|say that again|tell me again|what did you say|one more time)[.!?]?$/i, "REPEAT"],
  [/^(?:please )?(?:edit|correct|change) (?:the |my )?(?:record|entry)[.!?]?$/i, "EDIT_RECORD"],
  [/^(?:please )?(?:pause(?: the guide)?|hold on|wait a second|stop for a moment)[.!?]?$/i, "PAUSE"],
  [/^(?:please )?(?:resume(?: the guide)?|continue|go on|keep going)[.!?]?$/i, "RESUME"],
  [/^(?:no|nope|not yet|i (?:have not|haven't|did not|didn't)(?: finish(?:ed)?| complete(?:d)?| refill(?:ed)?)?|i'm not done)[.!?]?$/i, "CONFIRM_NO"],
  [/^(?:yes|yeah|yep|i (?:did it|finished|completed|refilled|refilled it|have finished|have completed)|done|finished|completed)[.!?]?$/i, "CONFIRM_YES"],
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
