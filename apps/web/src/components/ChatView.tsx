import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Chat, Message } from "@tele/shared";
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

  // Reset draft on chat switch only — don't clobber an in-flight typing session
  // when a WS event arrives mid-edit (per plan A8).
  useEffect(() => {
    setContextDraft(chat.ai_context ?? "");
    setContextOpen(false);
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
      <div className="border-b border-slate-800 bg-slate-900 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">
              {[chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
                chat.username ||
                chat.tg_chat_id}
            </div>
            {chat.username && <div className="text-xs text-slate-500">@{chat.username}</div>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleSlashOnly.mutate(!chat.slash_only)}
              disabled={toggleSlashOnly.isPending}
              className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                chat.slash_only
                  ? "bg-amber-900/60 text-amber-200 hover:bg-amber-900"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
              title="When on, plain-text messages are silently dropped — only slash commands run."
            >
              {chat.slash_only ? "Slash-only: on" : "Slash-only: off"}
            </button>
            <button
              onClick={() => toggleBlock.mutate(!chat.is_blocked)}
              disabled={toggleBlock.isPending}
              className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                chat.is_blocked
                  ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  : "bg-rose-900/50 text-rose-300 hover:bg-rose-900"
              }`}
            >
              {chat.is_blocked ? "Unblock" : "Block"}
            </button>
          </div>
        </div>
        <div className="mt-2">
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {contextOpen ? "Hide context" : "Context"}
            {chat.ai_context && !contextOpen && (
              <span className="ml-2 rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-200">
                set
              </span>
            )}
          </button>
          {contextOpen && (
            <div className="mt-2 space-y-2">
              <textarea
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                rows={4}
                placeholder="Per-chat AI context — appended to the system instruction. Empty = none."
                maxLength={8000}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setContext.mutate(contextDraft || null)}
                  disabled={setContext.isPending}
                  className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium hover:bg-indigo-500 disabled:opacity-50"
                >
                  {setContext.isPending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setContextDraft("");
                    setContext.mutate(null);
                  }}
                  disabled={setContext.isPending}
                  className="rounded bg-slate-700 px-3 py-1 text-xs font-medium hover:bg-slate-600 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-950 p-4">
        {q.data?.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      <Composer onSend={sendManual} />
    </div>
  );
}
