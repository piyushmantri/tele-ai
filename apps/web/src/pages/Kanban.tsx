import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Chat,
  KanbanComment,
  KanbanStatus,
  KanbanTask,
} from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";

const COLUMNS: { status: KanbanStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

function chatTitle(c: Chat): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || c.tg_chat_id;
}

function nextStatus(s: KanbanStatus): KanbanStatus | null {
  if (s === "todo") return "in_progress";
  if (s === "in_progress") return "done";
  return null;
}

function prevStatus(s: KanbanStatus): KanbanStatus | null {
  if (s === "done") return "in_progress";
  if (s === "in_progress") return "todo";
  return null;
}

export default function Kanban() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newStatus, setNewStatus] = useState<KanbanStatus>("todo");

  const tasksQ = useQuery({
    queryKey: qk.kanban,
    queryFn: () => api.get<{ tasks: KanbanTask[] }>("/api/kanban/tasks"),
  });
  const chatsQ = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });

  useWsEvent("kanban:task_changed", () => {
    qc.invalidateQueries({ queryKey: qk.kanban });
  });
  useWsEvent("kanban:comment_added", (e) => {
    qc.invalidateQueries({ queryKey: qk.kanbanTask(e.payload.comment.task_id) });
  });

  const createTask = useMutation({
    mutationFn: (body: {
      title: string;
      description?: string;
      status?: KanbanStatus;
      assignee_chat_id?: string | null;
    }) => api.post<{ task: KanbanTask }>("/api/kanban/tasks", body),
    onSuccess: () => {
      setCreating(false);
      setNewTitle("");
      setNewDescription("");
      setNewAssignee("");
      setNewStatus("todo");
      qc.invalidateQueries({ queryKey: qk.kanban });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KanbanStatus }) =>
      api.put(`/api/kanban/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.kanban }),
  });

  const tasks = tasksQ.data?.tasks ?? [];
  const chats = chatsQ.data?.chats ?? [];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kanban</h1>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          {creating ? "Cancel" : "+ New task"}
        </button>
      </div>

      {creating && (
        <div className="mb-6 max-w-3xl rounded border border-slate-800 bg-slate-900 p-4">
          <div className="grid grid-cols-12 gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="title"
              className="col-span-6 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
            />
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              className="col-span-4 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {chatTitle(c)}
                </option>
              ))}
            </select>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as KanbanStatus)}
              className="col-span-2 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
            >
              {COLUMNS.map((c) => (
                <option key={c.status} value={c.status}>
                  {c.label}
                </option>
              ))}
            </select>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="description"
              className="col-span-12 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              disabled={!newTitle || createTask.isPending}
              onClick={() =>
                createTask.mutate({
                  title: newTitle,
                  description: newDescription || undefined,
                  status: newStatus,
                  assignee_chat_id: newAssignee || null,
                })
              }
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          return (
            <div
              key={col.status}
              className="flex-1 rounded border border-slate-800 bg-slate-900 p-3"
            >
              <div className="mb-3 flex items-center justify-between text-xs uppercase text-slate-500">
                <span>{col.label}</span>
                <span>{colTasks.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setOpenId(t.id)}
                    className="cursor-pointer rounded border border-slate-700 bg-slate-800 p-3 hover:border-slate-600"
                  >
                    <div className="mb-2 text-sm font-medium">{t.title}</div>
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          t.assignee_name
                            ? "bg-indigo-900 text-indigo-200"
                            : "bg-slate-700 text-slate-400"
                        }`}
                      >
                        {t.assignee_name ?? "Unassigned"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {(t.comment_count ?? 0) > 0 ? `${t.comment_count} 💬` : ""}
                      </span>
                    </div>
                    <div
                      className="mt-2 flex justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {prevStatus(t.status) && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: t.id, status: prevStatus(t.status)! })
                          }
                          className="rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600"
                        >
                          ←
                        </button>
                      )}
                      {nextStatus(t.status) && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: t.id, status: nextStatus(t.status)! })
                          }
                          className="rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600"
                        >
                          →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div className="rounded border border-dashed border-slate-700 px-3 py-6 text-center text-xs text-slate-600">
                    Empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openId && (
        <TaskModal
          taskId={openId}
          chats={chats}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function TaskModal({
  taskId,
  chats,
  onClose,
}: {
  taskId: string;
  chats: Chat[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: qk.kanbanTask(taskId),
    queryFn: () =>
      api.get<{ task: KanbanTask; comments: KanbanComment[] }>(
        `/api/kanban/tasks/${taskId}`,
      ),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<KanbanStatus>("todo");
  const [assignee, setAssignee] = useState<string>("");
  const [commentBody, setCommentBody] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (detailQ.data && !loaded) {
    setTitle(detailQ.data.task.title);
    setDescription(detailQ.data.task.description);
    setStatus(detailQ.data.task.status);
    setAssignee(detailQ.data.task.assignee_chat_id ?? "");
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: () =>
      api.put(`/api/kanban/tasks/${taskId}`, {
        title,
        description,
        status,
        assignee_chat_id: assignee === "" ? null : assignee,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.kanban });
      qc.invalidateQueries({ queryKey: qk.kanbanTask(taskId) });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/kanban/tasks/${taskId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.kanban });
      onClose();
    },
  });

  const addComment = useMutation({
    mutationFn: () =>
      api.post(`/api/kanban/tasks/${taskId}/comments`, { body: commentBody }),
    onSuccess: () => {
      setCommentBody("");
      qc.invalidateQueries({ queryKey: qk.kanbanTask(taskId) });
      qc.invalidateQueries({ queryKey: qk.kanban });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded border border-slate-700 bg-slate-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Task</h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {!detailQ.data ? (
          <div className="text-sm text-slate-500">Loading...</div>
        ) : (
          <>
            <div className="mb-3">
              <label className="mb-1 block text-xs uppercase text-slate-500">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs uppercase text-slate-500">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs uppercase text-slate-500">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as KanbanStatus)}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
                >
                  {COLUMNS.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase text-slate-500">Assignee</label>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {chats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {chatTitle(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-4 flex justify-between">
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="rounded bg-rose-700 px-3 py-1.5 text-sm hover:bg-rose-600 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
              >
                Save
              </button>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Comments</h3>
              <div className="mb-3 flex flex-col gap-2">
                {detailQ.data.comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded border border-slate-800 bg-slate-800/50 p-2 text-sm"
                  >
                    <div className="mb-1 text-xs text-slate-500">
                      {c.author} · {new Date(c.created_at).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap">{c.body}</div>
                  </div>
                ))}
                {detailQ.data.comments.length === 0 && (
                  <div className="text-xs text-slate-500">No comments yet.</div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add a comment..."
                  className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => addComment.mutate()}
                  disabled={!commentBody || addComment.isPending}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm hover:bg-indigo-500 disabled:opacity-50"
                >
                  Post
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
