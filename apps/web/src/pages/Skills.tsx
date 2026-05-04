import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Skill } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

type SourceMode = "inline" | "path";

type FormState = {
  name: string;
  description: string;
  source: SourceMode;
  content: string;
  path: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  source: "inline",
  content: "",
  path: "",
};

export default function Skills() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const q = useQuery({
    queryKey: qk.skills,
    queryFn: () => api.get<{ skills: Skill[] }>("/api/skills"),
  });

  const add = useMutation({
    mutationFn: (body: object) => api.post("/api/skills", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: qk.skills });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/api/skills/${id}`, body),
    onSuccess: () => {
      setEditId(null);
      qc.invalidateQueries({ queryKey: qk.skills });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/skills/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skills }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.skills }),
  });

  function buildBody(f: FormState): object {
    return {
      name: f.name,
      description: f.description,
      content: f.source === "inline" ? f.content : "",
      path: f.source === "path" ? f.path : null,
    };
  }

  function handleAdd() {
    add.mutate(buildBody(form));
  }

  function startEdit(s: Skill) {
    setEditId(s.id);
    setEditForm({
      name: s.name,
      description: s.description,
      source: s.path ? "path" : "inline",
      content: s.content ?? "",
      path: s.path ?? "",
    });
  }

  function handleUpdate() {
    if (!editId) return;
    update.mutate({ id: editId, body: buildBody(editForm) });
  }

  async function loadFromPath(id: string) {
    try {
      const res = await api.get<{ content: string }>(`/api/skills/${id}/file`);
      setEditForm((f) => ({ ...f, content: res.content, source: "inline" }));
    } catch (err) {
      alert(`Failed to load file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Skills</h1>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          {showAdd ? "Cancel" : "+ Add skill"}
        </button>
      </div>

      <p className="mb-4 max-w-2xl text-xs text-slate-500">
        Skills are markdown prompts the AI can load on demand via{" "}
        <code className="font-mono">list_skills</code> /{" "}
        <code className="font-mono">load_skill</code>. Filesystem-path skills must be
        readable by the server process.
      </p>

      {showAdd && (
        <div className="mb-6 max-w-2xl space-y-3 rounded border border-slate-700 bg-slate-900 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name (kebab-case)</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="my-skill"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Source</label>
              <select
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value as SourceMode }))
                }
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="inline">inline (textarea)</option>
                <option value="path">filesystem path</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short description for the AI to decide when to invoke"
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          {form.source === "inline" ? (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Content (markdown)</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="# Skill instructions..."
                rows={8}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Filesystem path</label>
              <input
                value={form.path}
                onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
                placeholder="/abs/path/to/SKILL.md"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </div>
          )}

          {add.error && <p className="text-xs text-rose-400">{String(add.error)}</p>}

          <div className="flex justify-end">
            <button
              disabled={
                !form.name ||
                add.isPending ||
                (form.source === "inline" ? !form.content : !form.path)
              }
              onClick={handleAdd}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {add.isPending ? "Adding…" : "Add skill"}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-4xl rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.skills.map((s) =>
              editId === s.id ? (
                <tr key={s.id} className="border-b border-slate-700 bg-slate-800/60">
                  <td colSpan={5} className="px-4 py-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Name</label>
                          <input
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, name: e.target.value }))
                            }
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Source</label>
                          <select
                            value={editForm.source}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                source: e.target.value as SourceMode,
                              }))
                            }
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                          >
                            <option value="inline">inline (textarea)</option>
                            <option value="path">filesystem path</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-slate-400">
                          Description
                        </label>
                        <input
                          value={editForm.description}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, description: e.target.value }))
                          }
                          className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                        />
                      </div>

                      {editForm.source === "inline" ? (
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">
                            Content (markdown)
                          </label>
                          <textarea
                            value={editForm.content}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, content: e.target.value }))
                            }
                            rows={8}
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">
                            Filesystem path
                          </label>
                          <div className="flex gap-2">
                            <input
                              value={editForm.path}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, path: e.target.value }))
                              }
                              className="flex-1 rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                            />
                            <button
                              onClick={() => loadFromPath(s.id)}
                              className="rounded bg-slate-600 px-3 py-1.5 text-xs font-medium hover:bg-slate-500"
                            >
                              Preview file
                            </button>
                          </div>
                        </div>
                      )}

                      {update.error && (
                        <p className="text-xs text-rose-400">{String(update.error)}</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleUpdate}
                          disabled={update.isPending}
                          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
                        >
                          {update.isPending ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className="border-b border-slate-800 last:border-b-0">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="max-w-md truncate px-4 py-2 text-xs text-slate-400">
                    {s.description || "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-400">
                    {s.path ? (
                      <span title={s.path} className="block max-w-xs truncate">
                        {s.path}
                      </span>
                    ) : (
                      <span className="rounded bg-slate-700 px-2 py-0.5">inline</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        s.enabled
                          ? "bg-emerald-900/60 text-emerald-200 hover:bg-emerald-900"
                          : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                      }`}
                    >
                      {s.enabled ? "enabled" : "disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => startEdit(s)}
                      className="mr-3 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove.mutate(s.id)}
                      className="text-xs text-rose-400 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ),
            )}
            {q.data?.skills.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No skills configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
