import type { ToolDef } from "./index.js";
import {
  createComment,
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "../../db/repos/kanban.js";
import { getChatById } from "../../db/repos/chats.js";
import { eventBus } from "../../util/eventBus.js";
import type { KanbanStatus } from "@tele/shared";

const STATUS_VALUES: KanbanStatus[] = ["todo", "in_progress", "done"];

function isStatus(s: unknown): s is KanbanStatus {
  return typeof s === "string" && (STATUS_VALUES as string[]).includes(s);
}

export function makeKanbanTools(): ToolDef[] {
  const create: ToolDef = {
    declaration: {
      name: "create_task",
      description:
        "Create a new kanban task on the shared board. To set an assignee, first call `lookup_contacts` to resolve a person's name to their internal `id`, then pass that id as `assignee_chat_id`. Omit `assignee_chat_id` for unassigned tasks.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title." },
          description: { type: "string", description: "Optional longer description." },
          status: {
            type: "string",
            enum: STATUS_VALUES,
            description: "Initial status. Defaults to 'todo'.",
          },
          assignee_chat_id: {
            type: "string",
            description:
              "Internal chat UUID of the assignee from lookup_contacts. Omit for unassigned.",
          },
        },
        required: ["title"],
      },
    },
    handler: async (args) => {
      const a = args as {
        title?: unknown;
        description?: unknown;
        status?: unknown;
        assignee_chat_id?: unknown;
      };
      const title = typeof a.title === "string" ? a.title.trim() : "";
      if (!title) return { ok: false, error: "title required" };
      const status = isStatus(a.status) ? a.status : undefined;
      let assigneeId: string | null | undefined;
      if (typeof a.assignee_chat_id === "string" && a.assignee_chat_id.trim() !== "") {
        const chat = await getChatById(a.assignee_chat_id);
        if (!chat)
          return {
            ok: false,
            error: "unknown contact id; call lookup_contacts first",
          };
        assigneeId = a.assignee_chat_id;
      }
      const task = await createTask({
        title,
        description: typeof a.description === "string" ? a.description : undefined,
        status,
        assignee_chat_id: assigneeId,
      });
      eventBus.emit({ type: "kanban:task_changed", payload: { task } });
      return { ok: true, task };
    },
  };

  const update: ToolDef = {
    declaration: {
      name: "update_task",
      description:
        "Update a kanban task's fields. To reassign, first call `lookup_contacts` to get the internal `id` and pass it as `assignee_chat_id`. Pass `assignee_chat_id: null` to unassign. If `id` missing or task not found returns { ok: false, error }.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id." },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: STATUS_VALUES },
          assignee_chat_id: {
            type: "string",
            description:
              "Internal chat UUID of the new assignee, or null to clear assignee.",
          },
        },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const a = args as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        status?: unknown;
        assignee_chat_id?: unknown;
      };
      const id = typeof a.id === "string" ? a.id : "";
      if (!id) return { ok: false, error: "id required" };
      const existing = await getTask(id);
      if (!existing) return { ok: false, error: "task not found" };

      const patch: {
        title?: string;
        description?: string;
        status?: KanbanStatus;
        assignee_chat_id?: string | null;
      } = {};
      if (typeof a.title === "string") patch.title = a.title;
      if (typeof a.description === "string") patch.description = a.description;
      if (isStatus(a.status)) patch.status = a.status;
      if (Object.prototype.hasOwnProperty.call(a, "assignee_chat_id")) {
        if (a.assignee_chat_id === null) {
          patch.assignee_chat_id = null;
        } else if (typeof a.assignee_chat_id === "string" && a.assignee_chat_id.trim() !== "") {
          const chat = await getChatById(a.assignee_chat_id);
          if (!chat)
            return {
              ok: false,
              error: "unknown contact id; call lookup_contacts first",
            };
          patch.assignee_chat_id = a.assignee_chat_id;
        }
      }
      if (Object.keys(patch).length === 0)
        return { ok: false, error: "no fields to update" };
      const task = await updateTask(id, patch);
      if (!task) return { ok: false, error: "no fields to update" };
      eventBus.emit({ type: "kanban:task_changed", payload: { task } });
      return { ok: true, task };
    },
  };

  const comment: ToolDef = {
    declaration: {
      name: "add_task_comment",
      description: "Append a comment to a kanban task.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          body: { type: "string" },
          author: {
            type: "string",
            description: "Optional author label. Defaults to 'ai'.",
          },
        },
        required: ["task_id", "body"],
      },
    },
    handler: async (args) => {
      const a = args as { task_id?: unknown; body?: unknown; author?: unknown };
      const taskId = typeof a.task_id === "string" ? a.task_id : "";
      const body = typeof a.body === "string" ? a.body : "";
      if (!taskId || !body) return { ok: false, error: "task_id and body required" };
      const existing = await getTask(taskId);
      if (!existing) return { ok: false, error: "task not found" };
      const c = await createComment({
        task_id: taskId,
        author: typeof a.author === "string" && a.author ? a.author : "ai",
        body,
      });
      eventBus.emit({ type: "kanban:comment_added", payload: { comment: c } });
      return { ok: true, comment: c };
    },
  };

  const list: ToolDef = {
    declaration: {
      name: "list_tasks",
      description:
        "List kanban tasks. Optional filters: status, assignee_chat_id (use lookup_contacts to resolve a name to an id for 'what's on Alice's plate?' queries). Returns trimmed records (id, title, status, assignee_chat_id, assignee_name, comment_count).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: STATUS_VALUES },
          assignee_chat_id: { type: "string" },
        },
      },
    },
    handler: async (args) => {
      const a = args as { status?: unknown; assignee_chat_id?: unknown };
      const all = await listTasks();
      const filtered = all.filter((t) => {
        if (isStatus(a.status) && t.status !== a.status) return false;
        if (typeof a.assignee_chat_id === "string" && a.assignee_chat_id) {
          if (t.assignee_chat_id !== a.assignee_chat_id) return false;
        }
        return true;
      });
      return {
        ok: true,
        tasks: filtered.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assignee_chat_id: t.assignee_chat_id,
          assignee_name: t.assignee_name,
          comment_count: t.comment_count ?? 0,
        })),
      };
    },
  };

  return [create, update, comment, list];
}
