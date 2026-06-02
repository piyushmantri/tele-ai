import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, TextArea, Button, Badge, Alert, Switch } from "kodeui";
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

const TYPE_OPTIONS = [
  { value: "stdio", label: "stdio (local process)" },
  { value: "sse", label: "SSE (remote HTTP)" },
];

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
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
        >
          MCP Servers
        </h1>
        <Button variant="filled" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "Cancel" : "+ Add server"}
        </Button>
      </div>

      {showAdd && (
        <div className="mb-6 max-w-2xl">
          <Card>
            <CardBody>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Name (no spaces)"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="my_server"
                  />
                  <Select
                    label="Type"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "stdio" | "sse" }))}
                    options={TYPE_OPTIONS}
                  />
                </div>

                {form.type === "stdio" ? (
                  <Input
                    label="Command"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                    style={{ fontFamily: "var(--kode-font-mono)" }}
                  />
                ) : (
                  <Input
                    label="SSE URL"
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="http://localhost:8080/sse"
                    style={{ fontFamily: "var(--kode-font-mono)" }}
                  />
                )}

                <TextArea
                  label="Env vars (KEY=VALUE per line, optional)"
                  value={form.env}
                  onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                  placeholder={"API_KEY=abc123\nDEBUG=1"}
                  rows={3}
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />

                {add.error && <Alert variant="error">{String(add.error)}</Alert>}

                <div className="flex justify-end">
                  <Button
                    variant="filled"
                    disabled={!form.name || add.isPending || (form.type === "stdio" ? !form.command : !form.url)}
                    onClick={handleAdd}
                  >
                    {add.isPending ? "Connecting…" : "Add & connect"}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div
        className="max-w-3xl rounded"
        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
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
                <tr key={s.id} style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}>
                  <td colSpan={5} className="px-4 py-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          label="Name"
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        />
                        <Select
                          label="Type"
                          value={editForm.type}
                          onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as "stdio" | "sse" }))}
                          options={TYPE_OPTIONS}
                        />
                      </div>

                      {editForm.type === "stdio" ? (
                        <Input
                          label="Command"
                          value={editForm.command}
                          onChange={(e) => setEditForm((f) => ({ ...f, command: e.target.value }))}
                          style={{ fontFamily: "var(--kode-font-mono)" }}
                        />
                      ) : (
                        <Input
                          label="SSE URL"
                          value={editForm.url}
                          onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                          style={{ fontFamily: "var(--kode-font-mono)" }}
                        />
                      )}

                      <TextArea
                        label="Env vars (KEY=VALUE per line)"
                        value={editForm.env}
                        onChange={(e) => setEditForm((f) => ({ ...f, env: e.target.value }))}
                        rows={3}
                        style={{ fontFamily: "var(--kode-font-mono)" }}
                      />

                      {update.error && <Alert variant="error">{String(update.error)}</Alert>}

                      <div className="flex gap-2">
                        <Button variant="filled" onClick={handleUpdate} disabled={update.isPending}>
                          {update.isPending ? "Saving…" : "Save"}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant="default">{s.type}</Badge>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs" style={{ color: "var(--kode-text-muted)" }}>
                    {s.command ?? s.url ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Switch
                      checked={s.enabled}
                      onChange={(checked: boolean) => toggle.mutate({ id: s.id, enabled: checked })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              )
            )}
            {q.data?.servers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
                  No MCP servers configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Tools exposed by connected MCP servers are automatically available to Gemini.
        Tool names are prefixed <code className="font-mono">mcp__&lt;name&gt;__&lt;tool&gt;</code>.
      </p>
    </div>
  );
}
