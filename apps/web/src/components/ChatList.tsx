import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Chat } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

interface Props {
  chats: Chat[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function chatTitle(c: Chat): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || (c.username ? `@${c.username}` : c.tg_chat_id);
}

export default function ChatList({ chats, selectedId, onSelect }: Props) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/chats/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: qk.chats });
      if (id === selectedId) onSelect("");
    },
  });

  return (
    <div className="flex h-full w-64 flex-col overflow-y-auto border-r border-slate-800 bg-slate-900">
      {chats.length === 0 && (
        <div className="p-4 text-sm text-slate-500">No conversations yet.</div>
      )}
      {chats.map((c) => {
        const sel = c.id === selectedId;
        return (
          <div
            key={c.id}
            className={`group flex items-center gap-1 border-b border-slate-800 hover:bg-slate-800 ${
              sel ? "bg-slate-800" : ""
            }`}
          >
            <button
              onClick={() => onSelect(c.id)}
              className="flex flex-1 flex-col items-start gap-0.5 px-3 py-3 text-left text-sm"
            >
              <div className="flex w-full items-center justify-between">
                <span className="truncate font-medium">{chatTitle(c)}</span>
                {c.unread_count > 0 && (
                  <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs">
                    {c.unread_count}
                  </span>
                )}
              </div>
              {c.username && (
                <span className="truncate text-xs text-slate-500">@{c.username}</span>
              )}
            </button>
            <button
              type="button"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete chat with ${chatTitle(c)}? This removes all messages permanently.`)) {
                  del.mutate(c.id);
                }
              }}
              disabled={del.isPending}
              className="mr-2 rounded px-2 py-1 text-xs text-slate-500 opacity-0 hover:bg-rose-600 hover:text-white group-hover:opacity-100 disabled:opacity-50"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
