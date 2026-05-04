import { query } from "../index.js";

export interface SentPoll {
  id: string;
  chat_id: string;
  poll_id: string;
  question: string;
  options: string[];
  tg_message_id: string | null;
  tg_chat_id: string;
  created_at: string;
}

export async function storePoll(input: {
  poll_id: string;
  chat_id: string;
  question: string;
  options: string[];
  tg_message_id?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO sent_polls (poll_id, chat_id, question, options, tg_message_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (poll_id) DO UPDATE SET tg_message_id = EXCLUDED.tg_message_id`,
    [input.poll_id, input.chat_id, input.question, JSON.stringify(input.options), input.tg_message_id ?? null],
  );
}

export async function getPollByPollId(pollId: string): Promise<SentPoll | null> {
  const rows = await query<SentPoll>(
    `SELECT sp.id, sp.chat_id, sp.poll_id, sp.question, sp.options, sp.tg_message_id,
            c.tg_chat_id::text, sp.created_at
       FROM sent_polls sp
       JOIN chats c ON c.id = sp.chat_id
      WHERE sp.poll_id = $1`,
    [pollId],
  );
  return rows[0] ?? null;
}

export async function listSentPolls(chatId: string, limit = 5): Promise<SentPoll[]> {
  return query<SentPoll>(
    `SELECT sp.id, sp.chat_id, sp.poll_id, sp.question, sp.options, sp.tg_message_id,
            c.tg_chat_id::text, sp.created_at
       FROM sent_polls sp
       JOIN chats c ON c.id = sp.chat_id
      WHERE sp.chat_id = $1
      ORDER BY sp.created_at DESC
      LIMIT $2`,
    [chatId, limit],
  );
}
