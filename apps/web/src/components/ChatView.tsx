import { useEffect, useRef } from "react";
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

  const toggleBlock = useMutation({
    mutationFn: (blocked: boolean) =>
      api.patch(`/api/chats/${chat.id}/blocked`, { blocked }),
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
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-950 p-4">
        {q.data?.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      <Composer onSend={sendManual} />
    </div>
  );
}
