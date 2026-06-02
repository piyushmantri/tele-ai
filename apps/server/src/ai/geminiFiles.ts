import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { updateGeminiUri, readLocalFile, type FileMeta } from "../db/repos/applicationFiles.js";

let _fileManager: GoogleAIFileManager | null = null;

function getFileManager(): GoogleAIFileManager {
  if (!_fileManager) {
    _fileManager = new GoogleAIFileManager(config.GEMINI_API_KEY);
  }
  return _fileManager;
}

function isExpired(file: FileMeta): boolean {
  if (!file.gemini_file_uri || !file.gemini_expires_at) return true;
  // Treat as expired 10 minutes before actual expiry to avoid race conditions.
  const expiresAt = new Date(file.gemini_expires_at).getTime() - 10 * 60 * 1000;
  return Date.now() >= expiresAt;
}

/**
 * Ensures a Gemini File API URI exists for the file, uploading (or re-uploading) if
 * the cached URI is absent or expired. Returns the valid URI.
 * Throws on upload failure — callers should catch and skip the file.
 */
export async function ensureGeminiUri(file: FileMeta): Promise<string> {
  if (!isExpired(file)) {
    return file.gemini_file_uri!;
  }

  logger.info("uploading file to Gemini File API", { fileId: file.id, filename: file.filename });

  // Read from local disk; write to a temp file so the FileManager has a path to read.
  const buf = await readLocalFile(file.local_path);
  const tmpPath = join(tmpdir(), `${randomUUID()}_${file.filename}`);
  await writeFile(tmpPath, buf);

  try {
    const fm = getFileManager();
    const result = await fm.uploadFile(tmpPath, {
      mimeType: file.mime_type,
      displayName: file.filename,
    });
    const { uri, name, expirationTime } = result.file;
    const expiresAt = expirationTime ?? new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();
    await updateGeminiUri(file.id, uri, name, expiresAt);
    logger.info("Gemini file uploaded", { fileId: file.id, uri });
    return uri;
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}
