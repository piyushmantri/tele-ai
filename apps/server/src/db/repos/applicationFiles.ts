import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { query } from "../index.js";
import type { ApplicationFile } from "@tele/shared";

const COLS =
  "id, application_id, chat_id, filename, mime_type, size_bytes, local_path, gemini_file_uri, gemini_file_name, gemini_expires_at, created_at";

export type FileMeta = {
  id: string;
  application_id: string;
  chat_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  local_path: string;
  gemini_file_uri: string | null;
  gemini_file_name: string | null;
  gemini_expires_at: string | null;
  created_at: string;
};

function toPublic(row: FileMeta): ApplicationFile {
  return {
    id: row.id,
    application_id: row.application_id,
    chat_id: row.chat_id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    gemini_file_uri: row.gemini_file_uri,
    gemini_expires_at: row.gemini_expires_at,
    created_at: row.created_at,
  };
}

/** App-level files (dashboard uploads, chat_id IS NULL) — public shape */
export async function listAppFiles(applicationId: string): Promise<ApplicationFile[]> {
  const rows = await query<FileMeta>(
    `SELECT ${COLS} FROM application_files WHERE application_id = $1 AND chat_id IS NULL ORDER BY created_at ASC`,
    [applicationId],
  );
  return rows.map(toPublic);
}

/** App-level files as FileMeta (AI use — needs local_path + gemini columns) */
export async function listAppFilesMeta(applicationId: string): Promise<FileMeta[]> {
  return query<FileMeta>(
    `SELECT ${COLS} FROM application_files WHERE application_id = $1 AND chat_id IS NULL ORDER BY created_at ASC`,
    [applicationId],
  );
}

/** Chat-scoped files (Telegram uploads, chat_id = chatId) */
export async function listChatFilesMeta(applicationId: string, chatId: string): Promise<FileMeta[]> {
  return query<FileMeta>(
    `SELECT ${COLS} FROM application_files WHERE application_id = $1 AND chat_id = $2 ORDER BY created_at ASC`,
    [applicationId, chatId],
  );
}

export async function getFileMeta(fileId: string): Promise<FileMeta | null> {
  const rows = await query<FileMeta>(
    `SELECT ${COLS} FROM application_files WHERE id = $1`,
    [fileId],
  );
  return rows[0] ?? null;
}

export async function countFiles(applicationId: string, chatId: string | null): Promise<number> {
  const rows = await query<{ c: string }>(
    chatId === null
      ? `SELECT COUNT(*)::text AS c FROM application_files WHERE application_id = $1 AND chat_id IS NULL`
      : `SELECT COUNT(*)::text AS c FROM application_files WHERE application_id = $1 AND chat_id = $2`,
    chatId === null ? [applicationId] : [applicationId, chatId],
  );
  return parseInt(rows[0]?.c ?? "0", 10);
}

export async function createFile(params: {
  applicationId: string;
  chatId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  localPath: string;
}): Promise<FileMeta> {
  const rows = await query<FileMeta>(
    `INSERT INTO application_files (application_id, chat_id, filename, mime_type, size_bytes, local_path)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [params.applicationId, params.chatId, params.filename, params.mimeType, params.sizeBytes, params.localPath],
  );
  return rows[0]!;
}

export async function updateGeminiUri(
  fileId: string,
  uri: string,
  name: string,
  expiresAt: string,
): Promise<void> {
  await query(
    `UPDATE application_files SET gemini_file_uri = $1, gemini_file_name = $2, gemini_expires_at = $3 WHERE id = $4`,
    [uri, name, expiresAt, fileId],
  );
}

export async function deleteFile(fileId: string): Promise<FileMeta | null> {
  const rows = await query<FileMeta>(
    `DELETE FROM application_files WHERE id = $1 RETURNING ${COLS}`,
    [fileId],
  );
  return rows[0] ?? null;
}

/** Non-global enabled apps specifically assigned to a chat (for Telegram media ingestion). */
export async function getApplicationsAssignedToChat(
  chatId: string,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  return query<{ id: string; name: string; slug: string }>(
    `SELECT a.id, a.name, a.slug
     FROM applications a
     JOIN application_chats ac ON ac.application_id = a.id
     WHERE ac.chat_id = $1
       AND ac.enabled = TRUE
       AND a.enabled = TRUE
       AND a.is_global_default = FALSE`,
    [chatId],
  );
}

/** Save a buffer to disk under data/applications/. Returns the relative path stored in DB. */
export async function saveFileLocally(
  applicationId: string,
  chatId: string | null,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const segment = chatId ? `chat_${chatId}` : "app";
  const dir = join("data", "applications", applicationId, segment);
  await mkdir(dir, { recursive: true });
  const uniqueName = `${randomUUID()}_${filename}`;
  const localPath = join(dir, uniqueName);
  await writeFile(localPath, buffer);
  return localPath;
}

/** Read local file bytes (for Gemini re-upload when URI expired). */
export async function readLocalFile(localPath: string): Promise<Buffer> {
  return readFile(localPath) as Promise<Buffer>;
}
