import type { Chat, Settings } from "@tele/shared";

const UNBLOCK_RE = /^\s*\/unblock\s+(\S+)\s*$/i;

export function tryUnblockCommand(
  _chat: Chat,
  text: string,
  settings: Settings,
): { matched: boolean; correct: boolean } {
  const m = UNBLOCK_RE.exec(text);
  if (!m) return { matched: false, correct: false };
  const provided = m[1]!.toLowerCase();
  const expected = settings.ai_username.trim().toLowerCase();
  return { matched: true, correct: provided === expected };
}
