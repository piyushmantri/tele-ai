import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createComment,
  createTask,
  deleteTask,
  getTask,
  listComments,
  listTasks,
  updateTask,
} from "../../db/repos/kanban.js";
import { eventBus } from "../../util/eventBus.js";

const STATUS = z.enum(["todo", "in_progress", "done"]);

export async function registerKanbanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/kanban/tasks", async () => {
    return { tasks: await listTasks() };
  });

  app.post("/api/kanban/tasks", async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: STATUS.optional(),
        assignee_chat_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const task = await createTask(body);
    eventBus.emit({ type: "kanban:task_changed", payload: { task } });
    reply.code(201);
    return { task };
  });

  app.get("/api/kanban/tasks/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const task = await getTask(params.id);
    if (!task) {
      reply.code(404);
      return { error: "not found" };
    }
    const comments = await listComments(params.id);
    return { task, comments };
  });

  app.put("/api/kanban/tasks/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: STATUS.optional(),
        assignee_chat_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const existing = await getTask(params.id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    const task = await updateTask(params.id, body);
    if (!task) {
      reply.code(400);
      return { error: "no fields to update" };
    }
    eventBus.emit({ type: "kanban:task_changed", payload: { task } });
    return { task };
  });

  app.delete("/api/kanban/tasks/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getTask(params.id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteTask(params.id);
    eventBus.emit({
      type: "kanban:task_changed",
      payload: { task: existing, deleted: true },
    });
    return { ok: true };
  });

  app.post("/api/kanban/tasks/:id/comments", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        author: z.string().optional(),
        body: z.string().min(1),
      })
      .parse(req.body);
    const existing = await getTask(params.id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    const comment = await createComment({
      task_id: params.id,
      author: body.author ?? "user",
      body: body.body,
    });
    eventBus.emit({ type: "kanban:comment_added", payload: { comment } });
    reply.code(201);
    return { comment };
  });
}
