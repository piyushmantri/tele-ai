import type { Application, ApplicationChatAssignment } from "@tele/shared";
import { query } from "../index.js";

const COLS =
  "a.id, a.slug, a.name, a.type, a.description, a.system_prompt, a.knowledge_base, a.database_url, a.is_global_default, a.enabled, a.registry_slug, a.installed_path, a.created_at, r.source_type";

const FROM = "applications a LEFT JOIN application_registry r ON r.slug = a.registry_slug";

const INSERT_RETURNING =
  "id, slug, name, type, description, system_prompt, knowledge_base, database_url, is_global_default, enabled, registry_slug, installed_path, created_at, null as source_type";

export async function listApplications(): Promise<Application[]> {
  return query<Application>(
    `SELECT ${COLS} FROM ${FROM} ORDER BY a.created_at ASC`,
  );
}

export async function getApplication(id: string): Promise<Application | null> {
  const rows = await query<Application>(
    `SELECT ${COLS} FROM ${FROM} WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getApplicationBySlug(
  slug: string,
): Promise<Application | null> {
  const rows = await query<Application>(
    `SELECT ${COLS} FROM ${FROM} WHERE a.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getApplicationByRegistrySlug(
  registrySlug: string,
): Promise<Application | null> {
  const rows = await query<Application>(
    `SELECT ${COLS} FROM ${FROM} WHERE a.registry_slug = $1 LIMIT 1`,
    [registrySlug],
  );
  return rows[0] ?? null;
}

export async function createApplication(input: {
  slug: string;
  name: string;
  type: "code" | "ai_only";
  description?: string;
  system_prompt?: string | null;
  knowledge_base?: string | null;
  database_url?: string | null;
  is_global_default?: boolean;
  registry_slug?: string | null;
  installed_path?: string | null;
}): Promise<Application> {
  const rows = await query<Application>(
    `INSERT INTO applications (slug, name, type, description, system_prompt, knowledge_base, database_url, is_global_default, registry_slug, installed_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${INSERT_RETURNING}`,
    [
      input.slug,
      input.name,
      input.type,
      input.description ?? "",
      input.system_prompt ?? null,
      input.knowledge_base ?? null,
      input.database_url ?? null,
      input.is_global_default ?? false,
      input.registry_slug ?? null,
      input.installed_path ?? null,
    ],
  );
  return rows[0]!;
}

export async function updateApplication(
  id: string,
  patch: Partial<{
    slug: string;
    name: string;
    description: string;
    system_prompt: string | null;
    knowledge_base: string | null;
    database_url: string | null;
    is_global_default: boolean;
    enabled: boolean;
    installed_path: string | null;
  }>,
): Promise<Application | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (Object.prototype.hasOwnProperty.call(patch, "slug")) {
    sets.push(`slug = $${i++}`);
    vals.push(patch.slug);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    sets.push(`name = $${i++}`);
    vals.push(patch.name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "description")) {
    sets.push(`description = $${i++}`);
    vals.push(patch.description);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "system_prompt")) {
    sets.push(`system_prompt = $${i++}`);
    vals.push(patch.system_prompt);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "knowledge_base")) {
    sets.push(`knowledge_base = $${i++}`);
    vals.push(patch.knowledge_base);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "database_url")) {
    sets.push(`database_url = $${i++}`);
    vals.push(patch.database_url);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "is_global_default")) {
    sets.push(`is_global_default = $${i++}`);
    vals.push(patch.is_global_default);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    sets.push(`enabled = $${i++}`);
    vals.push(patch.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "installed_path")) {
    sets.push(`installed_path = $${i++}`);
    vals.push(patch.installed_path);
  }
  if (sets.length === 0) return getApplication(id);
  vals.push(id);
  const rows = await query<Application>(
    `UPDATE applications SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${INSERT_RETURNING}`,
    vals,
  );
  return rows[0] ?? null;
}

export async function deleteApplication(id: string): Promise<void> {
  await query(`DELETE FROM applications WHERE id = $1`, [id]);
}

export async function listAssignmentsForApplication(
  applicationId: string,
): Promise<ApplicationChatAssignment[]> {
  return query<ApplicationChatAssignment>(
    `SELECT application_id, chat_id, enabled, created_at
     FROM application_chats
     WHERE application_id = $1
     ORDER BY created_at ASC`,
    [applicationId],
  );
}

export async function setAssignment(
  applicationId: string,
  chatId: string,
  enabled: boolean,
): Promise<ApplicationChatAssignment> {
  const rows = await query<ApplicationChatAssignment>(
    `INSERT INTO application_chats (application_id, chat_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id, chat_id) DO UPDATE SET enabled = EXCLUDED.enabled
     RETURNING application_id, chat_id, enabled, created_at`,
    [applicationId, chatId, enabled],
  );
  return rows[0]!;
}

export async function removeAssignment(
  applicationId: string,
  chatId: string,
): Promise<void> {
  await query(
    `DELETE FROM application_chats WHERE application_id = $1 AND chat_id = $2`,
    [applicationId, chatId],
  );
}

export async function getActiveApplicationsForChat(
  chatId: string,
): Promise<Application[]> {
  return query<Application>(
    `SELECT ${COLS}
     FROM ${FROM}
     WHERE a.enabled = TRUE
       AND (
         a.is_global_default = TRUE
         OR EXISTS (
           SELECT 1 FROM application_chats ac
           WHERE ac.application_id = a.id
             AND ac.chat_id = $1
             AND ac.enabled = TRUE
         )
       )
     ORDER BY a.created_at ASC`,
    [chatId],
  );
}

export async function listApplicationsForChat(chatId: string): Promise<
  Array<
    Application & {
      assignment_enabled: boolean | null;
    }
  >
> {
  return query<Application & { assignment_enabled: boolean | null }>(
    `SELECT ${COLS.split(", ")
      .map((c) => `a.${c}`)
      .join(", ")}, ac.enabled AS assignment_enabled
     FROM applications a
     LEFT JOIN application_chats ac
       ON ac.application_id = a.id AND ac.chat_id = $1
     ORDER BY a.created_at ASC`,
    [chatId],
  );
}
