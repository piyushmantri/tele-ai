import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MCPServer } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

const EMPTY_FORM = { name: "", type: "stdio" as "stdio" | "sse", command: "", url: "", env: "" };

type EditForm = { name: string; type: "stdio" | "sse"; command: string; url: string; env: string };

function envToString(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export default function MCPServers() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_FORM);

  const q = useQuery({
    queryKey: qk.mcp,
    queryFn: () => api.get<{ servers: MCPServer[] }>("/api/mcp"),
  });

  const add = useMutation({
    mutationFn: (body: object) => api.post("/api/mcp", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: qk.mcp });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.put(`/api/mcp/${id}`, body),
    onSuccess: () => {
      setEditId(null);
      qc.invalidateQueries({ queryKey: qk.mcp });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/mcp/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mcp }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/mcp/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mcp }),
  });

  function parseEnv(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
  }

  function handleAdd() {
    add.mutate({
      name: form.name,
      type: form.type,
      command: form.type === "stdio" ? form.command : undefined,
      url: form.type === "sse" ? form.url : undefined,
      env: parseEnv(form.env),
    });
  }

  function startEdit(s: MCPServer) {
    setEditId(s.id);
    setEditForm({
      name: s.name,
      type: s.type as "stdio" | "sse",
      command: s.command ?? "",
      url: s.url ?? "",
      env: envToString(s.env ?? {}),
    });
  }

  function handleUpdate() {
    if (!editId) return;
    update.mutate({
      id: editId,
      body: {
        name: editForm.name,
        type: editForm.type,
        command: editForm.type === "stdio" ? editForm.command : undefined,
        url: editForm.type === "sse" ? editForm.url : undefined,
        env: parseEnv(editForm.env),
      },
    });
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">MCP Servers</h1>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          {showAdd ? "Cancel" : "+ Add server"}
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 max-w-2xl rounded border border-slate-700 bg-slate-900 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name (no spaces)</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="my_server"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "stdio" | "sse" }))}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="stdio">stdio (local process)</option>
                <option value="sse">SSE (remote HTTP)</option>
              </select>
            </div>
          </div>

          {form.type === "stdio" ? (
            <div>
              <label className="mb-1 block text-xs text-slate-400">Command</label>
              <input
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-slate-400">SSE URL</label>
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="http://localhost:8080/sse"
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-slate-400">Env vars (KEY=VALUE per line, optional)</label>
            <textarea
              value={form.env}
              onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
              placeholder={"API_KEY=abc123\nDEBUG=1"}
              rows={3}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
            />
          </div>

          {add.error && (
            <p className="text-xs text-rose-400">{String(add.error)}</p>
          )}

          <div className="flex justify-end">
            <button
              disabled={!form.name || add.isPending || (form.type === "stdio" ? !form.command : !form.url)}
              onClick={handleAdd}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {add.isPending ? "Connecting…" : "Add & connect"}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-3xl rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Command / URL</th>
              <th className="px-4 py-2">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.servers.map((s) =>
              editId === s.id ? (
                <tr key={s.id} className="border-b border-slate-700 bg-slate-800/60">
                  <td colSpan={5} className="px-4 py-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Name</label>
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Type</label>
                          <select
                            value={editForm.type}
                            onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as "stdio" | "sse" }))}
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm"
                          >
                            <option value="stdio">stdio (local process)</option>
                            <option value="sse">SSE (remote HTTP)</option>
                          </select>
                        </div>
                      </div>

                      {editForm.type === "stdio" ? (
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Command</label>
                          <input
                            value={editForm.command}
                            onChange={(e) => setEditForm((f) => ({ ...f, command: e.target.value }))}
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">SSE URL</label>
                          <input
                            value={editForm.url}
                            onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                          />
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Env vars (KEY=VALUE per line)</label>
                        <textarea
                          value={editForm.env}
                          onChange={(e) => setEditForm((f) => ({ ...f, env: e.target.value }))}
                          rows={3}
                          className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm"
                        />
                      </div>

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
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{s.type}</span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-slate-400">
                    {s.command ?? s.url ?? "—"}
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
              )
            )}
            {q.data?.servers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No MCP servers configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-slate-500">
        Tools exposed by connected MCP servers are automatically available to Gemini.
        Tool names are prefixed <code className="font-mono">mcp__&lt;name&gt;__&lt;tool&gt;</code>.
      </p>
    </div>
  );
}
