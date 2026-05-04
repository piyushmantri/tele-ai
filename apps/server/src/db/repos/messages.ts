import type { Message } from "@tele/shared";
import { sql } from "../index.js";

export async function insertMessage(input: {
  chat_id: string;
  tg_message_id: bigint | string | null;
  direction: "in" | "out";
  text: string;
  source: "user" | "ai" | "manual";
}): Promise<Message> {
  const rows = (await sql`
    INSERT INTO messages (chat_id, tg_message_id, direction, text, source)
    VALUES (${input.chat_id},
            ${input.tg_message_id == null ? null : String(input.tg_message_id)},
            ${input.direction}, ${input.text}, ${input.source})
    RETURNING id, chat_id, tg_message_id::text, direction, text, source, created_at
  `) as Message[];
  return rows[0]!;
}

export async function listMessages(
  chat_id: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  const rows = before
    ? ((await sql`
        SELECT id, chat_id, tg_message_id::text, direction, text, source, created_at
          FROM messages
         WHERE chat_id = ${chat_id} AND created_at < ${before}
         ORDER BY created_at DESC
         LIMIT ${limit}
      `) as Message[])
    : ((await sql`
        SELECT id, chat_id, tg_message_id::text, direction, text, source, created_at
          FROM messages
         WHERE chat_id = ${chat_id}
         ORDER BY created_at DESC
         LIMIT ${limit}
      `) as Message[]);
  return rows.reverse();
}

export async function getRecentForAi(chat_id: string, limit = 20): Promise<Message[]> {
  const rows = (await sql`
    SELECT id, chat_id, tg_message_id::text, direction, text, source, created_at
      FROM messages
     WHERE chat_id = ${chat_id}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `) as Message[];
  return rows.reverse();
}
