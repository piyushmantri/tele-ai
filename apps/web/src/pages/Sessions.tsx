import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chat } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";
import ChatList from "../components/ChatList";
import ChatView from "../components/ChatView";

export default function Sessions() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });

  useWsEvent("message:new", () => {
    qc.invalidateQueries({ queryKey: qk.chats });
  });
  useWsEvent("message:sent", () => {
    qc.invalidateQueries({ queryKey: qk.chats });
  });
  useWsEvent("chat:updated", () => {
    qc.invalidateQueries({ queryKey: qk.chats });
  });
  useWsEvent("chat:deleted", (e) => {
    qc.invalidateQueries({ queryKey: qk.chats });
    if (e.payload.chat_id === selectedId) setSelectedId(null);
  });

  const chats = q.data?.chats ?? [];
  const selected = chats.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <ChatList chats={chats} selectedId={selectedId} onSelect={setSelectedId} />
      {selected ? (
        <ChatView chat={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Select a chat to view messages.
        </div>
      )}
    </div>
  );
}
