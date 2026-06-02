import { query } from "../index.js";

export interface ApplicationMessage {
  id: string;
  application_id: string;
  tg_chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ApplicationChat {
  tg_chat_id: string;
  message_count: number;
  last_at: string;
  last_preview: string;
}

export async function listAppChats(applicationId: string): Promise<ApplicationChat[]> {
  return query<ApplicationChat>(
    `SELECT
       tg_chat_id,
       COUNT(*)::int AS message_count,
       MAX(created_at) AS last_at,
       LEFT(
         (SELECT content FROM application_messages m2
          WHERE m2.application_id = m.application_id AND m2.tg_chat_id = m.tg_chat_id
          ORDER BY created_at DESC LIMIT 1),
         120
       ) AS last_preview
     FROM application_messages m
     WHERE application_id = $1
     GROUP BY application_id, tg_chat_id
     ORDER BY MAX(created_at) DESC`,
    [applicationId],
  );
}

export async function listChatMessages(
  applicationId: string,
  tgChatId: string,
): Promise<ApplicationMessage[]> {
  return query<ApplicationMessage>(
    `SELECT id, application_id, tg_chat_id, role, content, created_at
     FROM application_messages
     WHERE application_id = $1 AND tg_chat_id = $2
     ORDER BY created_at ASC`,
    [applicationId, tgChatId],
  );
}

export async function insertMessage(
  applicationId: string,
  tgChatId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await query(
    `INSERT INTO application_messages (application_id, tg_chat_id, role, content)
     VALUES ($1, $2, $3, $4)`,
    [applicationId, tgChatId, role, content],
  );
}
