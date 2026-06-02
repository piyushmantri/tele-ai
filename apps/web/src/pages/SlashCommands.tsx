import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, TextArea, Button, Badge, Alert, Switch } from "kodeui";
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

const TYPE_OPTIONS = [
  { value: "message", label: "message" },
  { value: "shell", label: "shell" },
  { value: "ai_prompt", label: "ai_prompt" },
  { value: "noop", label: "noop" },
];

const TYPE_OPTIONS_EDIT = [
  { value: "message", label: "message" },
  { value: "shell", label: "shell" },
  { value: "ai_prompt", label: "ai_prompt" },
];

interface BuiltinCommand {
  name: string;
  description: string;
}

const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "delete",
    description:
      "Deletes the current chat from the application (cascades to messages, polls, pending choices). Instant — no confirmation.",
  },
  {
    name: "block",
    description:
      "Blocks the current chat. Subsequent messages are dropped until unblocked. Instant.",
  },
  {
    name: "unblock <ai_username>",
    description:
      "Unblocks the current chat. Username must match Settings → AI username (default: woody). Case-insensitive. Wrong username silently ignored to avoid leaking the gating mechanism.",
  },
  {
    name: "context",
    description:
      "Manage per-chat AI context (appended to the system instruction). /context shows current; /context <text> sets; /context clear removes.",
  },
  {
    name: "slash-only on|off",
    description:
      "Toggle slash-only mode for the current chat. When on, plain-text messages are silently dropped — only slash commands are processed.",
  },
];

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
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
        >
          Commands
        </h1>
        <Button variant="filled" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "Cancel" : "+ Add command"}
        </Button>
      </div>

      <div className="mb-4 max-w-2xl space-y-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
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
        <div className="mb-6 max-w-2xl">
          <Card>
            <CardBody>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Name (lowercase)"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="ping"
                  />
                  <Select
                    label="Type"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SlashCommandType }))}
                    options={TYPE_OPTIONS}
                  />
                </div>

                <Input
                  label="Description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What this command does"
                />

                <TextArea
                  label="Action"
                  value={form.action}
                  onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                  placeholder={PLACEHOLDERS[form.type]}
                  rows={6}
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />

                {add.error && <Alert variant="error">{String(add.error)}</Alert>}

                <div className="flex justify-end">
                  <Button
                    variant="filled"
                    disabled={!form.name || !form.action || add.isPending}
                    onClick={handleAdd}
                  >
                    {add.isPending ? "Adding…" : "Add command"}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div
        className="max-w-4xl overflow-hidden rounded"
        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-32" />
            <col />
            <col className="w-24" />
            <col className="w-64" />
            <col className="w-20" />
            <col className="w-32" />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
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
                <tr key={c.id} style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-dark)" }}>
                  <td colSpan={6} className="px-4 py-4">
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
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, type: e.target.value as SlashCommandType }))
                          }
                          options={TYPE_OPTIONS_EDIT}
                        />
                      </div>

                      <Input
                        label="Description"
                        value={editForm.description}
                        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      />

                      <TextArea
                        label="Action"
                        value={editForm.action}
                        onChange={(e) => setEditForm((f) => ({ ...f, action: e.target.value }))}
                        placeholder={PLACEHOLDERS[editForm.type]}
                        rows={6}
                        style={{ fontFamily: "var(--kode-font-mono)" }}
                      />

                      {update.error && <Alert variant="error">{String(update.error)}</Alert>}

                      <div className="flex gap-2">
                        <Button
                          variant="filled"
                          onClick={handleUpdate}
                          disabled={update.isPending || !editForm.name || !editForm.action}
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
                <tr key={c.id} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                  <td className="truncate px-4 py-2 font-mono">/{c.name}</td>
                  <td className="truncate px-4 py-2 text-xs" style={{ color: "var(--kode-text-muted)" }} title={c.description}>
                    {c.description || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="default">{c.type}</Badge>
                  </td>
                  <td
                    className="truncate px-4 py-2 font-mono text-xs"
                    style={{ color: "var(--kode-text-muted)" }}
                    title={c.action}
                  >
                    {c.action}
                  </td>
                  <td className="px-4 py-2">
                    <Switch
                      checked={c.enabled}
                      onChange={(checked: boolean) => toggle.mutate({ id: c.id, enabled: checked })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(c.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ),
            )}
            {q.data?.slash_commands.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
                  No slash commands configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--kode-text-muted)" }}>
          System commands
        </h2>
        <p className="mb-3 text-xs" style={{ color: "var(--kode-text-muted)" }}>
          Built into the application. Always enabled. Cannot be edited or removed from the
          dashboard.
        </p>
        <div
          className="rounded"
          style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {BUILTIN_COMMANDS.map((b) => (
                <tr key={b.name} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                  <td className="px-4 py-2 font-mono">/{b.name}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: "var(--kode-text-muted)" }}>{b.description}</td>
                  <td className="px-4 py-2">
                    <Badge variant="warning">built-in</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
