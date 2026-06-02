import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, TextArea, Button, Badge, Alert, Switch } from "kodeui";
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

const SOURCE_OPTIONS = [
  { value: "inline", label: "inline (textarea)" },
  { value: "path", label: "filesystem path" },
];

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
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
        >
          Skills
        </h1>
        <Button variant="filled" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "Cancel" : "+ Add skill"}
        </Button>
      </div>

      <p className="mb-4 max-w-2xl text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Skills are markdown prompts the AI can load on demand via{" "}
        <code className="font-mono">list_skills</code> /{" "}
        <code className="font-mono">load_skill</code>. Filesystem-path skills must be
        readable by the server process.
      </p>

      {showAdd && (
        <div className="mb-6 max-w-2xl">
          <Card>
            <CardBody>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Name (kebab-case)"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="my-skill"
                  />
                  <Select
                    label="Source"
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as SourceMode }))}
                    options={SOURCE_OPTIONS}
                  />
                </div>

                <Input
                  label="Description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description for the AI to decide when to invoke"
                />

                {form.source === "inline" ? (
                  <TextArea
                    label="Content (markdown)"
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    placeholder="# Skill instructions..."
                    rows={8}
                    style={{ fontFamily: "var(--kode-font-mono)" }}
                  />
                ) : (
                  <Input
                    label="Filesystem path"
                    value={form.path}
                    onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
                    placeholder="/abs/path/to/SKILL.md"
                    style={{ fontFamily: "var(--kode-font-mono)" }}
                  />
                )}

                {add.error && <Alert variant="error">{String(add.error)}</Alert>}

                <div className="flex justify-end">
                  <Button
                    variant="filled"
                    disabled={
                      !form.name ||
                      add.isPending ||
                      (form.source === "inline" ? !form.content : !form.path)
                    }
                    onClick={handleAdd}
                  >
                    {add.isPending ? "Adding…" : "Add skill"}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div
        className="max-w-4xl rounded"
        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
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
                          label="Source"
                          value={editForm.source}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, source: e.target.value as SourceMode }))
                          }
                          options={SOURCE_OPTIONS}
                        />
                      </div>

                      <Input
                        label="Description"
                        value={editForm.description}
                        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      />

                      {editForm.source === "inline" ? (
                        <TextArea
                          label="Content (markdown)"
                          value={editForm.content}
                          onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                          rows={8}
                          style={{ fontFamily: "var(--kode-font-mono)" }}
                        />
                      ) : (
                        <div>
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <Input
                                label="Filesystem path"
                                value={editForm.path}
                                onChange={(e) => setEditForm((f) => ({ ...f, path: e.target.value }))}
                                style={{ fontFamily: "var(--kode-font-mono)" }}
                              />
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => loadFromPath(s.id)}>
                              Preview file
                            </Button>
                          </div>
                        </div>
                      )}

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
                  <td className="max-w-md truncate px-4 py-2 text-xs" style={{ color: "var(--kode-text-muted)" }}>
                    {s.description || "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--kode-text-muted)" }}>
                    {s.path ? (
                      <span title={s.path} className="block max-w-xs truncate">
                        {s.path}
                      </span>
                    ) : (
                      <Badge variant="default">inline</Badge>
                    )}
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
              ),
            )}
            {q.data?.skills.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
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
