import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardBody,
  Input,
  TextArea,
  Button,
  Badge,
  Alert,
  Switch,
  Spinner,
  Tabs,
} from "kodeui";
import type {
  Application,
  ApplicationChatAssignment,
  ApplicationFile,
  Chat,
} from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";
import PluginSlot from "../components/PluginSlot";
import ApplicationObservabilityTab from "../components/ApplicationObservabilityTab";

export default function ApplicationDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appsQ = useQuery({
    queryKey: qk.applications,
    queryFn: () => api.get<{ applications: Application[] }>("/api/applications"),
  });
  const app = appsQ.data?.applications.find((a) => a.id === id) ?? null;

  useWsEvent("application:changed", () => {
    qc.invalidateQueries({ queryKey: qk.applications });
  });
  useWsEvent("application_chat:changed", (e) => {
    if (e.payload.application_id === id) {
      qc.invalidateQueries({ queryKey: qk.applicationAssignments(id) });
    }
  });

  if (appsQ.isLoading) {
    return (
      <div className="p-6 text-sm flex items-center gap-2" style={{ color: "var(--kode-text-muted)" }}>
        <Spinner size="sm" />
        Loading…
      </div>
    );
  }
  if (!app) {
    return (
      <div className="p-6">
        <Link
          to="/applications"
          className="text-xs"
          style={{ color: "var(--kode-info)" }}
        >
          &larr; Back to Applications
        </Link>
        <div className="mt-4 text-sm" style={{ color: "var(--kode-text-muted)" }}>Application not found.</div>
      </div>
    );
  }

  const hasSettingsTab = app.type === "code" && app.registry_slug !== null;
  // Optional ?tab=observability hint. Defaults to "overview" when absent so
  // existing behavior is preserved.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const defaultTabId =
    requestedTab === "observability"
      ? "observability"
      : requestedTab === "settings" && hasSettingsTab
      ? "settings"
      : "overview";

  const overviewContent = (
    <>
      <Overview app={app} />
      <Section title="Knowledge Base">
        <KnowledgeBase appId={app.id} fileInputRef={fileInputRef} />
      </Section>
      <Section title="Chat Assignments">
        <ChatAssignments appId={app.id} />
      </Section>
      {app.type === "ai_only" && (
        <Section title="AI Config">
          <AiConfig app={app} />
        </Section>
      )}
      {app.type === "code" && (
        <Section title="Hook File">
          <HookFile appId={app.id} />
        </Section>
      )}
      <Section title="Data">
        <DataSection app={app} />
      </Section>
    </>
  );

  const observabilityContent = (
    <ApplicationObservabilityTab slug={app.slug} />
  );

  const tabs = hasSettingsTab
    ? [
        { id: "overview", label: "Overview", content: overviewContent },
        {
          id: "settings",
          label: "Settings",
          content: (
            <Section title="Application Settings">
              <PluginSlot slug={app.registry_slug!} appId={app.id} />
            </Section>
          ),
        },
        {
          id: "observability",
          label: "Observability",
          content: observabilityContent,
        },
      ]
    : [
        { id: "overview", label: "Overview", content: overviewContent },
        {
          id: "observability",
          label: "Observability",
          content: observabilityContent,
        },
      ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <Link
        to="/applications"
        className="mb-4 inline-block text-xs"
        style={{ color: "var(--kode-info)" }}
      >
        &larr; Back to Applications
      </Link>
      <Tabs tabs={tabs} defaultTab={defaultTabId} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--kode-text-secondary)" }}>{title}</h2>
      <Card>
        <CardBody>{children}</CardBody>
      </Card>
    </div>
  );
}

function Overview({ app }: { app: Application }) {
  const qc = useQueryClient();
  const [descDraft, setDescDraft] = useState(app.description);

  useEffect(() => {
    setDescDraft(app.description);
  }, [app.description]);

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/applications/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applications }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/api/applications/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applications }),
  });

  const dirty = descDraft !== app.description;

  return (
    <div className="mb-6">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold" style={{ color: "var(--kode-text-primary)" }}>{app.name}</h1>
            <Badge variant="default">{app.type}</Badge>
            {app.is_global_default && (
              <Badge variant="info">global default</Badge>
            )}
            <Switch
              checked={app.enabled}
              onChange={(checked: boolean) =>
                toggle.mutate({ id: app.id, enabled: checked })
              }
              disabled={toggle.isPending}
            />
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
            slug: <code className="font-mono">{app.slug}</code>
          </div>
          <div className="mt-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  label="Description"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                />
              </div>
              <Button
                variant="filled"
                disabled={!dirty || update.isPending}
                onClick={() =>
                  update.mutate({ id: app.id, body: { description: descDraft } })
                }
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
            {update.error && (
              <div className="mt-1">
                <Alert variant="error">{String(update.error)}</Alert>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function KnowledgeBase({
  appId,
  fileInputRef,
}: {
  appId: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const qc = useQueryClient();
  const filesQ = useQuery({
    queryKey: qk.applicationFiles(appId),
    queryFn: () =>
      api.get<{ files: ApplicationFile[] }>(
        `/api/applications/${appId}/files`,
      ),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.postFormData(`/api/applications/${appId}/files`, fd);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.applicationFiles(appId) }),
  });

  const remove = useMutation({
    mutationFn: (fileId: string) =>
      api.del(`/api/applications/${appId}/files/${fileId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.applicationFiles(appId) }),
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
        <span style={{ color: "var(--kode-text-muted)" }}>
          (app-level — shared across all chats)
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Supported: images (JPEG/PNG/WebP/GIF), PDF, text/markdown/CSV · Max 10
        MB · 20 files per app. Chat-specific files can be added by sending a
        file directly in a Telegram chat with this app assigned.
      </p>
      {filesQ.isLoading && (
        <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading…</div>
      )}
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
              <span className="ml-3 shrink-0" style={{ color: "var(--kode-text-muted)" }}>
                {formatBytes(f.size_bytes)}
              </span>
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
            {upload.error instanceof Error
              ? upload.error.message
              : "Upload failed"}
          </span>
        )}
      </div>
    </div>
  );
}

function ChatAssignments({ appId }: { appId: string }) {
  const qc = useQueryClient();
  const chatsQ = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });
  const assignmentsQ = useQuery({
    queryKey: qk.applicationAssignments(appId),
    queryFn: () =>
      api.get<{ assignments: ApplicationChatAssignment[] }>(
        `/api/applications/${appId}/assignments`,
      ),
  });

  const enable = useMutation({
    mutationFn: (chatId: string) =>
      api.put(`/api/applications/${appId}/chats/${chatId}`, {
        enabled: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qk.applicationAssignments(appId),
      });
    },
  });

  const disable = useMutation({
    mutationFn: (chatId: string) =>
      api.del(`/api/applications/${appId}/chats/${chatId}`),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qk.applicationAssignments(appId),
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

function AiConfig({ app }: { app: Application }) {
  const qc = useQueryClient();
  const [systemPrompt, setSystemPrompt] = useState(app.system_prompt ?? "");
  const [knowledgeBase, setKnowledgeBase] = useState(app.knowledge_base ?? "");

  useEffect(() => {
    setSystemPrompt(app.system_prompt ?? "");
    setKnowledgeBase(app.knowledge_base ?? "");
  }, [app.system_prompt, app.knowledge_base]);

  const update = useMutation({
    mutationFn: (body: object) => api.put(`/api/applications/${app.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.applications }),
  });

  return (
    <div className="space-y-3">
      <TextArea
        label="System prompt (required for ai_only)"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        rows={6}
        style={{ fontFamily: "var(--kode-font-mono)" }}
      />
      <TextArea
        label="Knowledge base (optional, appended after system prompt)"
        value={knowledgeBase}
        onChange={(e) => setKnowledgeBase(e.target.value)}
        rows={4}
        style={{ fontFamily: "var(--kode-font-mono)" }}
      />
      {update.error && <Alert variant="error">{String(update.error)}</Alert>}
      <div>
        <Button
          variant="filled"
          disabled={systemPrompt.trim() === "" || update.isPending}
          onClick={() =>
            update.mutate({
              system_prompt: systemPrompt,
              knowledge_base: knowledgeBase === "" ? null : knowledgeBase,
            })
          }
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function HookFile({ appId }: { appId: string }) {
  const hookQ = useQuery({
    queryKey: ["applications", appId, "hook"] as const,
    queryFn: () =>
      api.get<{ content: string | null }>(
        `/api/applications/${appId}/hook`,
      ),
  });

  if (hookQ.isLoading) {
    return <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading…</div>;
  }
  const content = hookQ.data?.content ?? null;
  return (
    <div className="space-y-2">
      {content === null ? (
        <div className="text-xs italic" style={{ color: "var(--kode-text-muted)" }}>
          No <code className="font-mono">hook.ts</code> on disk for this
          application.
        </div>
      ) : (
        <pre
          className="overflow-x-auto rounded p-3 font-mono text-xs"
          style={{ background: "var(--kode-bg-dark)", color: "var(--kode-text-secondary)" }}
        >
          {content}
        </pre>
      )}
      <p className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
        Read-only. Edit{" "}
        <code className="font-mono">apps/server/applications/&lt;slug&gt;/hook.ts</code>{" "}
        locally and restart the server to pick up changes (ESM module cache).
      </p>
    </div>
  );
}

function DataSection({ app }: { app: Application }) {
  const [result, setResult] = useState<{
    ok: boolean;
    latency_ms: number;
    error?: string;
  } | null>(null);

  const ping = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; latency_ms: number; error?: string }>(
        `/api/applications/${app.id}/ping-db`,
      ),
    onSuccess: (data) => setResult(data),
    onError: (err) =>
      setResult({
        ok: false,
        latency_ms: 0,
        error: err instanceof Error ? err.message : "request failed",
      }),
  });

  if (!app.database_url) {
    return (
      <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
        No database URL configured. Click <span style={{ color: "var(--kode-text-primary)" }}>Edit</span> on the Applications list page to add one.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <Button variant="filled" onClick={() => ping.mutate()} disabled={ping.isPending}>
          {ping.isPending ? "Testing…" : "Test connection"}
        </Button>
      </div>
      {result && (
        <div className="text-xs" style={{ color: result.ok ? "var(--kode-success)" : "var(--kode-error)" }}>
          {result.ok
            ? `Connected (${result.latency_ms}ms)`
            : `Failed: ${result.error ?? "unknown error"}`}
        </div>
      )}
    </div>
  );
}
