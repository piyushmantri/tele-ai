import { Fragment, useRef, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardBody,
  Select,
  Input,
  TextArea,
  Button,
  Badge,
  Alert,
  Switch,
} from "kodeui";
import type {
  Application,
  ApplicationChatAssignment,
  ApplicationFile,
  ApplicationRegistryEntry,
  ApplicationType,
  Chat,
} from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";
import AddApplicationForm from "../components/AddApplicationForm";

type FormState = {
  slug: string;
  name: string;
  type: ApplicationType;
  description: string;
  system_prompt: string;
  knowledge_base: string;
  database_url: string;
  is_global_default: boolean;
};

const EMPTY_FORM: FormState = {
  slug: "",
  name: "",
  type: "ai_only",
  description: "",
  system_prompt: "",
  knowledge_base: "",
  database_url: "",
  is_global_default: false,
};

const TYPE_OPTIONS = [
  { value: "ai_only", label: "ai_only (system prompt + KB)" },
  { value: "code", label: "code (hook.ts on disk)" },
];

function buildBody(f: FormState, includeSlug = true): object {
  const body: Record<string, unknown> = {
    name: f.name,
    description: f.description,
    is_global_default: f.is_global_default,
    system_prompt: f.system_prompt === "" ? null : f.system_prompt,
    knowledge_base: f.knowledge_base === "" ? null : f.knowledge_base,
    database_url: f.database_url === "" ? null : f.database_url,
  };
  if (includeSlug) body.slug = f.slug;
  return body;
}

export default function Applications() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [revealDb, setRevealDb] = useState(false);
  const [editRevealDb, setEditRevealDb] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [filesId, setFilesId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: qk.applications,
    queryFn: () => api.get<{ applications: Application[] }>("/api/applications"),
  });

  useWsEvent("application:changed", () => {
    qc.invalidateQueries({ queryKey: qk.applications });
  });
  useWsEvent("application_chat:changed", (e) => {
    qc.invalidateQueries({
      queryKey: qk.applicationAssignments(e.payload.application_id),
    });
    qc.invalidateQueries({ queryKey: qk.chatApplications(e.payload.chat_id) });
  });

  const add = useMutation({
    mutationFn: (body: object) => api.post("/api/applications", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setShowAdd(false);
      setRevealDb(false);
      qc.invalidateQueries({ queryKey: qk.applications });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/api/applications/${id}`, body),
    onSuccess: () => {
      setEditId(null);
      setEditRevealDb(false);
      qc.invalidateQueries({ queryKey: qk.applications });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/applications/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applications }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/applications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applications }),
  });

  function startEdit(a: Application) {
    setEditId(a.id);
    setEditRevealDb(false);
    setEditForm({
      slug: a.slug,
      name: a.name,
      type: a.type,
      description: a.description,
      system_prompt: a.system_prompt ?? "",
      knowledge_base: a.knowledge_base ?? "",
      database_url: a.database_url ?? "",
      is_global_default: a.is_global_default,
    });
  }

  function handleAdd() {
    add.mutate({ ...buildBody(form), type: form.type });
  }

  function handleUpdate() {
    if (!editId) return;
    const current = q.data?.applications.find((a) => a.id === editId);
    if (!current) return;
    update.mutate({
      id: editId,
      body: buildBody(editForm, current.type !== "code"),
    });
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
          >
            Applications
          </h1>
          <div
            className="ml-3 flex gap-1 rounded p-0.5"
            style={{ border: "1px solid var(--kode-border)" }}
          >
            {(["installed", "browse"] as const).map((t) => (
              <Button
                key={t}
                variant={tab === t ? "filled" : "ghost"}
                size="sm"
                onClick={() => setTab(t)}
              >
                {t === "installed" ? "Installed" : "Browse"}
              </Button>
            ))}
          </div>
        </div>
        {tab === "installed" && (
          <Button variant="filled" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? "Cancel" : "+ Add application"}
          </Button>
        )}
      </div>

      <p className="mb-4 max-w-2xl text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Applications attach a system prompt (and optional knowledge base, optional
        per-app database URL) to specific chats — or globally. Type{" "}
        <code className="font-mono">code</code> apps additionally load{" "}
        <code className="font-mono">apps/server/applications/&lt;slug&gt;/hook.ts</code>{" "}
        and call its <code className="font-mono">getContext(chatId)</code> export at
        responder time. Editing a code-app hook on disk requires a server restart
        (ESM module cache).
      </p>

      {tab === "browse" ? (
        <RegistryBrowser />
      ) : (
        <>
          {showAdd && (
            <div className="mb-6 max-w-2xl">
              <Card>
                <CardBody>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Slug (kebab/snake-case)"
                        value={form.slug}
                        onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                        placeholder="my-app"
                      />
                      <Select
                        label="Type"
                        value={form.type}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, type: e.target.value as ApplicationType }))
                        }
                        options={TYPE_OPTIONS}
                      />
                    </div>

                    <Input
                      label="Name"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Friendly display name"
                    />

                    <Input
                      label="Description"
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />

                    {form.type === "ai_only" && (
                      <>
                        <TextArea
                          label="System prompt (required for ai_only)"
                          value={form.system_prompt}
                          onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                          rows={6}
                          style={{ fontFamily: "var(--kode-font-mono)" }}
                        />
                        <TextArea
                          label="Knowledge base (optional, appended after system prompt)"
                          value={form.knowledge_base}
                          onChange={(e) => setForm((f) => ({ ...f, knowledge_base: e.target.value }))}
                          rows={4}
                          style={{ fontFamily: "var(--kode-font-mono)" }}
                        />
                      </>
                    )}

                    <Input
                      type={revealDb ? "text" : "password"}
                      label="Database URL (optional)"
                      value={form.database_url}
                      onChange={(e) => setForm((f) => ({ ...f, database_url: e.target.value }))}
                      onFocus={() => setRevealDb(true)}
                      onBlur={() => setRevealDb(false)}
                      placeholder="postgres://… (stored as plain TEXT — Neon at-rest only)"
                      style={{ fontFamily: "var(--kode-font-mono)" }}
                    />

                    <Switch
                      checked={form.is_global_default}
                      onChange={(checked: boolean) =>
                        setForm((f) => ({ ...f, is_global_default: checked }))
                      }
                      label="Global default (inject for every chat)"
                    />

                    {add.error && <Alert variant="error">{String(add.error)}</Alert>}

                    <div className="flex justify-end">
                      <Button
                        variant="filled"
                        disabled={
                          !form.slug ||
                          !form.name ||
                          add.isPending ||
                          (form.type === "ai_only" && !form.system_prompt.trim())
                        }
                        onClick={handleAdd}
                      >
                        {add.isPending ? "Adding…" : "Add application"}
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          <div
            className="max-w-5xl rounded"
            style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Default</th>
                  <th className="px-4 py-2">Enabled</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {q.data?.applications.map((a) => {
                  const isEditing = editId === a.id;
                  const isManaging = manageId === a.id;
                  return (
                    <Fragment key={a.id}>
                      {isEditing ? (
                        <tr style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}>
                          <td colSpan={6} className="px-4 py-4">
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <Input
                                  label={
                                    a.type === "code"
                                      ? "Slug (immutable for code apps)"
                                      : "Slug"
                                  }
                                  disabled={a.type === "code"}
                                  value={editForm.slug}
                                  onChange={(e) =>
                                    setEditForm((f) => ({ ...f, slug: e.target.value }))
                                  }
                                />
                                <Input
                                  label="Type"
                                  disabled
                                  value={editForm.type}
                                />
                              </div>
                              <Input
                                label="Name"
                                value={editForm.name}
                                onChange={(e) =>
                                  setEditForm((f) => ({ ...f, name: e.target.value }))
                                }
                              />
                              <Input
                                label="Description"
                                value={editForm.description}
                                onChange={(e) =>
                                  setEditForm((f) => ({ ...f, description: e.target.value }))
                                }
                              />
                              {editForm.type === "ai_only" && (
                                <>
                                  <TextArea
                                    label="System prompt (required)"
                                    value={editForm.system_prompt}
                                    onChange={(e) =>
                                      setEditForm((f) => ({
                                        ...f,
                                        system_prompt: e.target.value,
                                      }))
                                    }
                                    rows={6}
                                    style={{ fontFamily: "var(--kode-font-mono)" }}
                                  />
                                  <TextArea
                                    label="Knowledge base"
                                    value={editForm.knowledge_base}
                                    onChange={(e) =>
                                      setEditForm((f) => ({
                                        ...f,
                                        knowledge_base: e.target.value,
                                      }))
                                    }
                                    rows={4}
                                    style={{ fontFamily: "var(--kode-font-mono)" }}
                                  />
                                </>
                              )}
                              <Input
                                type={editRevealDb ? "text" : "password"}
                                label="Database URL"
                                value={editForm.database_url}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    database_url: e.target.value,
                                  }))
                                }
                                onFocus={() => setEditRevealDb(true)}
                                onBlur={() => setEditRevealDb(false)}
                                style={{ fontFamily: "var(--kode-font-mono)" }}
                              />
                              <Switch
                                checked={editForm.is_global_default}
                                onChange={(checked: boolean) =>
                                  setEditForm((f) => ({ ...f, is_global_default: checked }))
                                }
                                label="Global default"
                              />
                              {update.error && (
                                <Alert variant="error">{String(update.error)}</Alert>
                              )}
                              <div className="flex gap-2">
                                <Button
                                  variant="filled"
                                  onClick={handleUpdate}
                                  disabled={update.isPending}
                                >
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
                        <tr style={{ borderBottom: "1px solid var(--kode-border)" }}>
                          <td className="px-4 py-2 font-medium">
                            <Link
                              to={`/applications/${a.id}`}
                              style={{ color: "var(--kode-info)" }}
                            >
                              {a.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--kode-text-muted)" }}>
                            {a.slug}
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <Badge variant="default">{a.type}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            {a.is_global_default ? (
                              <Badge variant="info">global</Badge>
                            ) : (
                              <span className="text-xs" style={{ color: "var(--kode-text-muted)" }}>—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <Switch
                              checked={a.enabled}
                              onChange={(checked: boolean) =>
                                toggle.mutate({ id: a.id, enabled: checked })
                              }
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setManageId((curr) => (curr === a.id ? null : a.id))}
                            >
                              {isManaging ? "Hide chats" : "Manage chats"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setFilesId((curr) => (curr === a.id ? null : a.id))}
                            >
                              {filesId === a.id ? "Hide files" : "Files"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => startEdit(a)}>
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => remove.mutate(a.id)}>
                              Remove
                            </Button>
                          </td>
                        </tr>
                      )}
                      {isManaging && (
                        <tr key={`${a.id}-manage`} style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}>
                          <td colSpan={6} className="px-4 py-4">
                            <ManageAssignments applicationId={a.id} />
                          </td>
                        </tr>
                      )}
                      {filesId === a.id && (
                        <tr key={`${a.id}-files`} style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}>
                          <td colSpan={6} className="px-4 py-4">
                            <ManageFiles applicationId={a.id} fileInputRef={fileInputRef} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {q.data?.applications.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
                      No applications configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ManageAssignments({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const chatsQ = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });
  const assignmentsQ = useQuery({
    queryKey: qk.applicationAssignments(applicationId),
    queryFn: () =>
      api.get<{ assignments: ApplicationChatAssignment[] }>(
        `/api/applications/${applicationId}/assignments`,
      ),
  });

  const enable = useMutation({
    mutationFn: (chatId: string) =>
      api.put(`/api/applications/${applicationId}/chats/${chatId}`, {
        enabled: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qk.applicationAssignments(applicationId),
      });
    },
  });

  const disable = useMutation({
    mutationFn: (chatId: string) =>
      api.del(`/api/applications/${applicationId}/chats/${chatId}`),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qk.applicationAssignments(applicationId),
      });
    },
  });

  const assignedSet = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of assignmentsQ.data?.assignments ?? []) {
      m.set(a.chat_id, a.enabled);
    }
    return m;
  }, [assignmentsQ.data]);

  if (chatsQ.isLoading || assignmentsQ.isLoading) {
    return <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading…</div>;
  }
  return (
    <div>
      <div className="mb-2 text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Per-chat assignments. Global-default applications are injected for every
        chat regardless of these checkboxes.
      </div>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
        {chatsQ.data?.chats.map((c) => {
          const enabled = assignedSet.get(c.id) === true;
          const display =
            [c.first_name, c.last_name].filter(Boolean).join(" ") ||
            c.username ||
            c.tg_chat_id;
          return (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded px-2 py-1 text-xs"
              style={{ border: "1px solid var(--kode-border)" }}
            >
              <Switch
                checked={enabled}
                onChange={(checked: boolean) =>
                  checked ? enable.mutate(c.id) : disable.mutate(c.id)
                }
              />
              <span className="truncate" title={display}>
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManageFiles({
  applicationId,
  fileInputRef,
}: {
  applicationId: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const qc = useQueryClient();
  const filesQ = useQuery({
    queryKey: qk.applicationFiles(applicationId),
    queryFn: () => api.get<{ files: ApplicationFile[] }>(`/api/applications/${applicationId}/files`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.postFormData(`/api/applications/${applicationId}/files`, fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applicationFiles(applicationId) }),
  });

  const remove = useMutation({
    mutationFn: (fileId: string) =>
      api.del(`/api/applications/${applicationId}/files/${fileId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applicationFiles(applicationId) }),
  });

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium" style={{ color: "var(--kode-text-primary)" }}>
        Knowledge Base Files{" "}
        <span style={{ color: "var(--kode-text-muted)" }}>(app-level — shared across all chats)</span>
      </div>
      <p className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Supported: images (JPEG/PNG/WebP/GIF), PDF, text/markdown/CSV · Max 10 MB · 20 files per app.
        Chat-specific files can be added by sending a file directly in a Telegram chat with this app assigned.
      </p>
      {filesQ.isLoading && <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading…</div>}
      {filesQ.data?.files && filesQ.data.files.length > 0 && (
        <div className="space-y-1">
          {filesQ.data.files.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between rounded px-3 py-2 text-xs"
              style={{ border: "1px solid var(--kode-border)" }}
            >
              <span className="truncate" style={{ color: "var(--kode-text-primary)" }} title={f.filename}>
                {f.filename}
              </span>
              <span className="ml-3 shrink-0" style={{ color: "var(--kode-text-muted)" }}>{formatBytes(f.size_bytes)}</span>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(f.id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
      {filesQ.data?.files?.length === 0 && (
        <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>No files yet.</div>
      )}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.txt,.md,.csv,text/plain,text/markdown,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="filled"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? "Uploading…" : "Upload file"}
        </Button>
        {upload.isError && (
          <span className="ml-2 text-xs" style={{ color: "var(--kode-error)" }}>
            {upload.error instanceof Error ? upload.error.message : "Upload failed"}
          </span>
        )}
      </div>
    </div>
  );
}

function RegistryBrowser() {
  const q = useQuery({
    queryKey: qk.applicationsRegistry,
    queryFn: () =>
      api.get<{ entries: ApplicationRegistryEntry[] }>("/api/applications/registry"),
  });
  if (q.isLoading)
    return <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading registry…</div>;
  const entries = q.data?.entries ?? [];
  return (
    <div>
      <AddApplicationForm />
      {entries.length === 0 ? (
        <div
          className="max-w-5xl rounded p-6 text-center text-sm"
          style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)", color: "var(--kode-text-muted)" }}
        >
          No registry entries. Add one above to install a plugin from a git
          URL or local path.
        </div>
      ) : (
        <div className="grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-2">
          {entries.map((e) => (
            <RegistryCard key={e.slug} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function RegistryCard({ entry }: { entry: ApplicationRegistryEntry }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.applicationsRegistry });
    qc.invalidateQueries({ queryKey: qk.applications });
  };
  const install = useMutation({
    mutationFn: () => api.post(`/api/applications/install/${entry.slug}`),
    onSuccess: invalidate,
  });
  const uninstall = useMutation({
    mutationFn: () => api.del(`/api/applications/install/${entry.slug}`),
    onSuccess: invalidate,
  });
  const removeRegistry = useMutation({
    mutationFn: () => api.del(`/api/applications/registry/${entry.slug}`),
    onSuccess: invalidate,
  });
  const pending =
    install.isPending || uninstall.isPending || removeRegistry.isPending;
  const err = install.error ?? uninstall.error ?? removeRegistry.error;
  const sourceText = entry.source_type === "git" ? entry.source_url : entry.source_path;
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium" style={{ color: "var(--kode-text-primary)" }}>{entry.name}</div>
            <div className="font-mono text-xs" style={{ color: "var(--kode-text-muted)" }}>{entry.slug}</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={entry.source_type === "git" ? "info" : "default"}>
                {entry.source_type}
              </Badge>
              {sourceText && (
                <span
                  className="truncate font-mono text-[10px]"
                  style={{ color: "var(--kode-text-muted)" }}
                  title={sourceText}
                >
                  {sourceText}
                </span>
              )}
            </div>
          </div>
          <Badge variant="default">{entry.type}</Badge>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--kode-text-muted)" }}>{entry.description}</p>
        {entry.required_env_vars.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-xs">
            {entry.required_env_vars.map((v) => (
              <code
                key={v}
                className="rounded px-1.5 py-0.5"
                style={{ background: "var(--kode-bg-darker)", color: "var(--kode-text-secondary)" }}
              >
                {v}
              </code>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || entry.installed}
            onClick={() => {
              if (
                confirm(
                  `Remove "${entry.slug}" from the registry? On-disk plugin files are NOT deleted.`,
                )
              ) {
                removeRegistry.mutate();
              }
            }}
          >
            {removeRegistry.isPending ? "Removing…" : "Remove from registry"}
          </Button>
          {entry.installed ? (
            <Button
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    `Uninstall "${entry.name}"? Chat assignments and uploaded files will be removed. On-disk plugin files are preserved.`,
                  )
                ) {
                  uninstall.mutate();
                }
              }}
            >
              {uninstall.isPending ? "Uninstalling…" : "Uninstall"}
            </Button>
          ) : (
            <Button
              variant="filled"
              size="sm"
              disabled={pending}
              onClick={() => install.mutate()}
            >
              {install.isPending ? "Installing…" : "Install"}
            </Button>
          )}
        </div>
        {err && (
          <div className="mt-2">
            <Alert variant="error">{err instanceof Error ? err.message : String(err)}</Alert>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
