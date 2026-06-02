import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, TextArea, Switch, Badge, Card, CardBody, Tooltip } from "kodeui";
import type { Application, Chat, Message } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";

interface Props {
  chat: Chat;
}

export default function ChatView({ chat }: Props) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [contextOpen, setContextOpen] = useState(false);
  const [contextDraft, setContextDraft] = useState(chat.ai_context ?? "");
  const [appsOpen, setAppsOpen] = useState(false);

  // Reset draft on chat switch only — don't clobber an in-flight typing session
  // when a WS event arrives mid-edit (per plan A8).
  useEffect(() => {
    setContextDraft(chat.ai_context ?? "");
    setContextOpen(false);
    setAppsOpen(false);
  }, [chat.id]);

  const toggleBlock = useMutation({
    mutationFn: (blocked: boolean) =>
      api.patch(`/api/chats/${chat.id}/blocked`, { blocked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chats }),
  });

  const toggleSlashOnly = useMutation({
    mutationFn: (slash_only: boolean) =>
      api.patch(`/api/chats/${chat.id}/slash-only`, { slash_only }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chats }),
  });

  const setContext = useMutation({
    mutationFn: (context: string | null) =>
      api.patch(`/api/chats/${chat.id}/context`, { context }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chats }),
  });

  const chatAppsQ = useQuery({
    queryKey: qk.chatApplications(chat.id),
    queryFn: () =>
      api.get<{
        applications: Array<Application & { assignment_enabled: boolean | null }>;
      }>(`/api/chats/${chat.id}/applications`),
    enabled: appsOpen,
  });

  const enableApp = useMutation({
    mutationFn: (applicationId: string) =>
      api.put(`/api/applications/${applicationId}/chats/${chat.id}`, {
        enabled: true,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.chatApplications(chat.id) }),
  });

  const disableApp = useMutation({
    mutationFn: (applicationId: string) =>
      api.del(`/api/applications/${applicationId}/chats/${chat.id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.chatApplications(chat.id) }),
  });

  useWsEvent("application:changed", () => {
    qc.invalidateQueries({ queryKey: qk.chatApplications(chat.id) });
  });
  useWsEvent("application_chat:changed", (e) => {
    if (e.payload.chat_id !== chat.id) return;
    qc.invalidateQueries({ queryKey: qk.chatApplications(chat.id) });
  });

  const q = useQuery({
    queryKey: qk.chatMessages(chat.id),
    queryFn: () => api.get<{ messages: Message[] }>(`/api/chats/${chat.id}/messages`),
  });

  useEffect(() => {
    api.post(`/api/chats/${chat.id}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: qk.chats });
  }, [chat.id, qc]);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [q.data?.messages.length]);

  useWsEvent("message:new", (e) => {
    if (e.payload.chat.id !== chat.id) return;
    qc.setQueryData<{ messages: Message[] }>(qk.chatMessages(chat.id), (prev) => ({
      messages: [...(prev?.messages ?? []), e.payload.message],
    }));
  });
  useWsEvent("message:sent", (e) => {
    if (e.payload.chat.id !== chat.id) return;
    qc.setQueryData<{ messages: Message[] }>(qk.chatMessages(chat.id), (prev) => ({
      messages: [...(prev?.messages ?? []), e.payload.message],
    }));
  });

  async function sendManual(text: string) {
    await api.post(`/api/chats/${chat.id}/send`, { text });
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <div
        className="px-4 py-3 text-sm"
        style={{ borderBottom: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium" style={{ color: "var(--kode-text-primary)" }}>
              {[chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
                chat.username ||
                chat.tg_chat_id}
            </div>
            {chat.username && (
              <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>@{chat.username}</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Tooltip content="When on, plain-text messages are silently dropped — only slash commands run.">
              <span>
                <Switch
                  checked={chat.slash_only}
                  onChange={(checked: boolean) => toggleSlashOnly.mutate(checked)}
                  disabled={toggleSlashOnly.isPending}
                  label="Slash-only"
                />
              </span>
            </Tooltip>
            <Switch
              checked={chat.is_blocked}
              onChange={(checked: boolean) => toggleBlock.mutate(checked)}
              disabled={toggleBlock.isPending}
              label="Blocked"
            />
          </div>
        </div>
        <div className="mt-2">
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="text-xs"
            style={{ color: "var(--kode-text-muted)" }}
          >
            {contextOpen ? "Hide context" : "Context"}
            {chat.ai_context && !contextOpen && (
              <span className="ml-2">
                <Badge variant="info" pill>set</Badge>
              </span>
            )}
          </button>
          {contextOpen && (
            <div className="mt-2 space-y-2">
              <TextArea
                label="Per-chat context"
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                rows={4}
                placeholder="Per-chat AI context — appended to the system instruction. Empty = none."
                maxLength={8000}
              />
              <div className="flex gap-2">
                <Button
                  variant="filled"
                  size="sm"
                  onClick={() => setContext.mutate(contextDraft || null)}
                  disabled={setContext.isPending}
                >
                  {setContext.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setContextDraft("");
                    setContext.mutate(null);
                  }}
                  disabled={setContext.isPending}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2">
            <button
              onClick={() => setAppsOpen((v) => !v)}
              className="text-xs"
              style={{ color: "var(--kode-text-muted)" }}
            >
              {appsOpen ? "Hide applications" : "Applications"}
            </button>
            {appsOpen && (
              <div className="mt-2 space-y-1">
                {chatAppsQ.isLoading && (
                  <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>Loading…</div>
                )}
                {chatAppsQ.data?.applications.length === 0 && (
                  <div className="text-xs" style={{ color: "var(--kode-text-muted)" }}>
                    No applications configured.
                  </div>
                )}
                {chatAppsQ.data?.applications.map((a) => {
                  const isGlobal = a.is_global_default;
                  const checked = a.assignment_enabled === true;
                  return (
                    <Card key={a.id}>
                      <CardBody>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-medium" style={{ color: "var(--kode-text-primary)" }}>{a.name}</span>
                            <span className="font-mono" style={{ color: "var(--kode-text-muted)" }}>{a.type}</span>
                            {!a.enabled && (
                              <Badge variant="warning">disabled globally</Badge>
                            )}
                          </div>
                          {isGlobal ? (
                            <Badge variant="info">global</Badge>
                          ) : (
                            <Switch
                              checked={checked}
                              onChange={(c: boolean) =>
                                c ? enableApp.mutate(a.id) : disableApp.mutate(a.id)
                              }
                              label={a.name}
                            />
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-4"
        style={{ background: "var(--kode-bg-dark)" }}
      >
        {q.data?.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      <Composer onSend={sendManual} />
    </div>
  );
}
