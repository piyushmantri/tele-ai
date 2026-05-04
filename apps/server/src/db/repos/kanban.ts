import type { KanbanComment, KanbanStatus, KanbanTask } from "@tele/shared";
import { query } from "../index.js";

const SELECT_TASK = `
  SELECT t.id, t.title, t.description, t.status, t.assignee_chat_id,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.username, c.tg_chat_id::text) AS assignee_name,
         t.created_at, t.updated_at
    FROM kanban_tasks t
    LEFT JOIN chats c ON c.id = t.assignee_chat_id
`;

export async function listTasks(): Promise<KanbanTask[]> {
  return query<KanbanTask>(`
    SELECT t.id, t.title, t.description, t.status, t.assignee_chat_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.username, c.tg_chat_id::text) AS assignee_name,
           t.created_at, t.updated_at,
           (SELECT COUNT(*) FROM kanban_comments k WHERE k.task_id = t.id)::int AS comment_count
      FROM kanban_tasks t
      LEFT JOIN chats c ON c.id = t.assignee_chat_id
     ORDER BY t.status, t.updated_at DESC
  `);
}

export async function getTask(id: string): Promise<KanbanTask | null> {
  const rows = await query<KanbanTask>(`${SELECT_TASK} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createTask(input: {
  title: string;
  description?: string;
  status?: KanbanStatus;
  assignee_chat_id?: string | null;
}): Promise<KanbanTask> {
  const rows = await query<{ id: string }>(
    `INSERT INTO kanban_tasks (title, description, status, assignee_chat_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      input.title,
      input.description ?? "",
      input.status ?? "todo",
      input.assignee_chat_id ?? null,
    ],
  );
  const created = await getTask(rows[0]!.id);
  return created!;
}

export async function updateTask(
  id: string,
  patch: {
    title?: string;
    description?: string;
    status?: KanbanStatus;
    assignee_chat_id?: string | null;
  },
): Promise<KanbanTask | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (Object.prototype.hasOwnProperty.call(patch, "title") && patch.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(patch.title);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "description") && patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(patch.description);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "status") && patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "assignee_chat_id")) {
    sets.push(`assignee_chat_id = $${i++}`);
    params.push(patch.assignee_chat_id ?? null);
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = now()`);
  params.push(id);
  await query(
    `UPDATE kanban_tasks SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  await query(`DELETE FROM kanban_tasks WHERE id = $1`, [id]);
}

export async function listComments(taskId: string): Promise<KanbanComment[]> {
  return query<KanbanComment>(
    `SELECT id, task_id, author, body, created_at
       FROM kanban_comments
      WHERE task_id = $1
      ORDER BY created_at ASC`,
    [taskId],
  );
}

export async function createComment(input: {
  task_id: string;
  author: string;
  body: string;
}): Promise<KanbanComment> {
  const rows = await query<KanbanComment>(
    `INSERT INTO kanban_comments (task_id, author, body)
     VALUES ($1, $2, $3)
     RETURNING id, task_id, author, body, created_at`,
    [input.task_id, input.author, input.body],
  );
  return rows[0]!;
}
