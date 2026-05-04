import type { Chat } from "@tele/shared";
import { sql } from "../index.js";

export async function upsertChat(input: {
  tg_chat_id: bigint | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  chat_type: "private" | "group" | "channel";
}): Promise<Chat> {
  const tgId = String(input.tg_chat_id);
  const rows = (await sql`
    INSERT INTO chats (tg_chat_id, username, first_name, last_name, chat_type)
    VALUES (${tgId}, ${input.username}, ${input.first_name}, ${input.last_name}, ${input.chat_type})
    ON CONFLICT (tg_chat_id) DO UPDATE
      SET username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          chat_type = EXCLUDED.chat_type
    RETURNING id, tg_chat_id::text, username, first_name, last_name, chat_type,
              is_blocked, unread_count, last_message_at, created_at
  `) as Chat[];
  return rows[0]!;
}

export async function listChats(): Promise<Chat[]> {
  const rows = (await sql`
    SELECT id, tg_chat_id::text, username, first_name, last_name, chat_type,
           is_blocked, unread_count, last_message_at, created_at
      FROM chats
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
  `) as Chat[];
  return rows;
}

export async function getChatById(id: string): Promise<Chat | null> {
  const rows = (await sql`
    SELECT id, tg_chat_id::text, username, first_name, last_name, chat_type,
           is_blocked, unread_count, last_message_at, created_at
      FROM chats WHERE id = ${id}
  `) as Chat[];
  return rows[0] ?? null;
}

export async function getChatByTgId(tgChatId: bigint | string): Promise<Chat | null> {
  const rows = (await sql`
    SELECT id, tg_chat_id::text, username, first_name, last_name, chat_type,
           is_blocked, unread_count, last_message_at, created_at
      FROM chats WHERE tg_chat_id = ${String(tgChatId)}
  `) as Chat[];
  return rows[0] ?? null;
}

export async function setChatBlocked(id: string, blocked: boolean): Promise<void> {
  await sql`UPDATE chats SET is_blocked = ${blocked} WHERE id = ${id}`;
}

export async function bumpChatActivity(id: string, at: Date): Promise<Chat> {
  const rows = (await sql`
    UPDATE chats
       SET last_message_at = ${at.toISOString()}
     WHERE id = ${id}
     RETURNING id, tg_chat_id::text, username, first_name, last_name, chat_type,
               is_blocked, unread_count, last_message_at, created_at
  `) as Chat[];
  return rows[0]!;
}

export async function incUnread(id: string): Promise<void> {
  await sql`UPDATE chats SET unread_count = unread_count + 1 WHERE id = ${id}`;
}

export async function clearUnread(id: string): Promise<void> {
  await sql`UPDATE chats SET unread_count = 0 WHERE id = ${id}`;
}

export async function searchChats(query: string, limit = 10): Promise<Chat[]> {
  const q = `%${query}%`;
  const rows = (await sql`
    SELECT id, tg_chat_id::text, username, first_name, last_name, chat_type,
           is_blocked, unread_count, last_message_at, created_at
      FROM chats
     WHERE first_name ILIKE ${q}
        OR last_name ILIKE ${q}
        OR username ILIKE ${q}
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT ${limit}
  `) as Chat[];
  return rows;
}
