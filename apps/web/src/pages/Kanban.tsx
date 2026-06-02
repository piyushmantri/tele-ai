import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, TextArea, Button, Badge } from "kodeui";
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

  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...chats.map((c) => ({ value: c.id, label: chatTitle(c) })),
  ];
  const statusOptions = COLUMNS.map((c) => ({ value: c.status, label: c.label }));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
        >
          Kanban
        </h1>
        <Button variant="filled" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New task"}
        </Button>
      </div>

      {creating && (
        <div className="mb-6 max-w-3xl">
          <Card>
            <CardBody>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-6">
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="title"
                  />
                </div>
                <div className="col-span-4">
                  <Select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    options={assigneeOptions}
                  />
                </div>
                <div className="col-span-2">
                  <Select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as KanbanStatus)}
                    options={statusOptions}
                  />
                </div>
                <div className="col-span-12">
                  <TextArea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="description"
                    rows={2}
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="filled"
                  disabled={!newTitle || createTask.isPending}
                  onClick={() =>
                    createTask.mutate({
                      title: newTitle,
                      description: newDescription || undefined,
                      status: newStatus,
                      assignee_chat_id: newAssignee || null,
                    })
                  }
                >
                  Create
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div className="flex gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          return (
            <div
              key={col.status}
              className="flex-1 rounded p-3"
              style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
            >
              <div className="mb-3 flex items-center justify-between text-xs uppercase" style={{ color: "var(--kode-text-muted)" }}>
                <span>{col.label}</span>
                <span>{colTasks.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setOpenId(t.id)}
                    className="cursor-pointer rounded p-3"
                    style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}
                  >
                    <div className="mb-2 text-sm font-medium" style={{ color: "var(--kode-text-primary)" }}>{t.title}</div>
                    <div className="flex items-center justify-between">
                      <Badge variant={t.assignee_name ? "info" : "default"}>
                        {t.assignee_name ?? "Unassigned"}
                      </Badge>
                      <span className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
                        {(t.comment_count ?? 0) > 0 ? `${t.comment_count} 💬` : ""}
                      </span>
                    </div>
                    <div
                      className="mt-2 flex justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {prevStatus(t.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ id: t.id, status: prevStatus(t.status)! })
                          }
                        >
                          ←
                        </Button>
                      )}
                      {nextStatus(t.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({ id: t.id, status: nextStatus(t.status)! })
                          }
                        >
                          →
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div
                    className="rounded px-3 py-6 text-center text-xs"
                    style={{ border: "1px dashed var(--kode-border)", color: "var(--kode-text-muted)" }}
                  >
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

  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...chats.map((c) => ({ value: c.id, label: chatTitle(c) })),
  ];
  const statusOptions = COLUMNS.map((c) => ({ value: c.status, label: c.label }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <CardBody>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "var(--kode-text-primary)" }}>Task</h2>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>

            {!detailQ.data ? (
              <div className="text-sm" style={{ color: "var(--kode-text-muted)" }}>Loading...</div>
            ) : (
              <>
                <div className="mb-3">
                  <Input
                    label="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <TextArea
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <Select
                    label="Status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as KanbanStatus)}
                    options={statusOptions}
                  />
                  <Select
                    label="Assignee"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    options={assigneeOptions}
                  />
                </div>

                <div className="mb-4 flex justify-between">
                  <Button
                    variant="danger"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="filled"
                    onClick={() => save.mutate()}
                    disabled={save.isPending}
                  >
                    Save
                  </Button>
                </div>

                <div className="pt-4" style={{ borderTop: "1px solid var(--kode-border)" }}>
                  <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--kode-text-primary)" }}>
                    Comments
                  </h3>
                  <div className="mb-3 flex flex-col gap-2">
                    {detailQ.data.comments.map((c) => (
                      <div
                        key={c.id}
                        className="rounded p-2 text-sm"
                        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
                      >
                        <div className="mb-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
                          {c.author} · {new Date(c.created_at).toLocaleString()}
                        </div>
                        <div className="whitespace-pre-wrap">{c.body}</div>
                      </div>
                    ))}
                    {detailQ.data.comments.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
                        No comments yet.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder="Add a comment..."
                      />
                    </div>
                    <Button
                      variant="filled"
                      onClick={() => addComment.mutate()}
                      disabled={!commentBody || addComment.isPending}
                    >
                      Post
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
