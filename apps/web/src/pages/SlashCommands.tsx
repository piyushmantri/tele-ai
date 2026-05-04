import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SlashCommand, SlashCommandType } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

type FormState = {
  name: string;
  description: string;
  type: SlashCommandType;
  action: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  type: "message",
  action: "",
};

const PLACEHOLDERS: Record<SlashCommandType, string> = {
  shell: 'echo "hello {args}"',
  message: "Hello {args}!",
  ai_prompt: "You are a haiku poet. Reply only with a haiku.",
  noop: "-",
};

export default function SlashCommands() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const q = useQuery({
    queryKey: qk.slashCommands,
    queryFn: () => api.get<{ slash_commands: SlashCommand[] }>("/api/slash-commands"),
  });

  const add = useMutation({
    mutationFn: (body: object) => api.post("/api/slash-commands", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: qk.slashCommands });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/api/slash-commands/${id}`, body),
    onSuccess: () => {
      setEditId(null);
      qc.invalidateQueries({ queryKey: qk.slashCommands });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/slash-commands/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.slashCommands }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/slash-commands/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.slashCommands }),
  });

  function buildBody(f: FormState): object {
    return {
      name: f.name,
      description: f.description,
      type: f.type,
      action: f.action,
    };
  }

  function handleAdd() {
    add.mutate(buildBody(form));
  }

  function startEdit(c: SlashCommand) {
    setEditId(c.id);
    setEditForm({
      name: c.name,
      description: c.description,
      type: c.type,
      action: c.action,
    });
  }

  function handleUpdate() {
    if (!editId) return;
    update.mutate({ id: editId, body: buildBody(editForm) });
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Commands</h1>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          {showAdd ? "Cancel" : "+ Add command"}
        </button>
      </div>

      <div className="mb-4 max-w-2xl space-y-1 text-xs text-slate-500">
        <p>
          Slash commands intercept incoming messages that start with{" "}
          <code className="font-mono">/name</code>. Four types are supported:
        </p>
        <ul className="ml-4 list-disc">
          <li>
            <strong>message</strong> — replies with the action text verbatim.
          </li>
          <li>
            <strong>shell</strong> — runs the action as a zsh command (15s timeout, output
            truncated at 3500 chars). Runs unrestricted on the host — author actions you
            trust.
          </li>
          <li>
            <strong>ai_prompt</strong> — runs the normal AI flow but with the action used
            as the system prompt for that single reply.
          </li>
          <li>
            <strong>noop</strong> — silently ignores the message. No reply, no reaction.
            Action field is ignored (set it to <code className="font-mono">-</code>).
          </li>
        </ul>
        <p>
          Use <code className="font-mono">{"{args}"}</code> in the action to interpolate
          everything after the command name. Names are matched case-insensitively. Disabled
          commands fall through to the AI as if the command did not exist. When auto-reply
          is off, slash commands are also suppressed.
        </p>
      </div>

      {showAdd && (
        <div className="mb-6 max-w-2xl space-y-3 rounded border border-slate-700 bg-slate-900 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name (lowercase)</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ping"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Type</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value as SlashCommandType }))
                }
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="message">message</option>
                <option value="shell">shell</option>
                <option value="ai_prompt">ai_prompt</option>
                <option value="noop">noop</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this command does"
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Action</label>
            <textarea
              value={form.action}
              onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
              placeholder={PLACEHOLDERS[form.type]}
              rows={6}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
            />
          </div>

          {add.error && <p className="text-xs text-rose-400">{String(add.error)}</p>}

          <div className="flex justify-end">
            <button
              disabled={!form.name || !form.action || add.isPending}
              onClick={handleAdd}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {add.isPending ? "Adding…" : "Add command"}
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
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.slash_commands.map((c) =>
              editId === c.id ? (
                <tr key={c.id} className="border-b border-slate-700 bg-slate-800/60">
                  <td colSpan={6} className="px-4 py-4">
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
                          <label className="mb-1 block text-xs text-slate-400">Type</label>
                          <select
                            value={editForm.type}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                type: e.target.value as SlashCommandType,
                              }))
                            }
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                          >
                            <option value="message">message</option>
                            <option value="shell">shell</option>
                            <option value="ai_prompt">ai_prompt</option>
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

                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Action</label>
                        <textarea
                          value={editForm.action}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, action: e.target.value }))
                          }
                          placeholder={PLACEHOLDERS[editForm.type]}
                          rows={6}
                          className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                        />
                      </div>

                      {update.error && (
                        <p className="text-xs text-rose-400">{String(update.error)}</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleUpdate}
                          disabled={update.isPending || !editForm.name || !editForm.action}
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
                <tr key={c.id} className="border-b border-slate-800 last:border-b-0">
                  <td className="px-4 py-2 font-mono">/{c.name}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-400">
                    {c.description || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-700 px-2 py-0.5 font-mono text-xs">
                      {c.type}
                    </span>
                  </td>
                  <td
                    className="max-w-xs truncate px-4 py-2 font-mono text-xs text-slate-400"
                    title={c.action}
                  >
                    {c.action}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggle.mutate({ id: c.id, enabled: !c.enabled })}
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        c.enabled
                          ? "bg-emerald-900/60 text-emerald-200 hover:bg-emerald-900"
                          : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                      }`}
                    >
                      {c.enabled ? "enabled" : "disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => startEdit(c)}
                      className="mr-3 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove.mutate(c.id)}
                      className="text-xs text-rose-400 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ),
            )}
            {q.data?.slash_commands.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No slash commands configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
